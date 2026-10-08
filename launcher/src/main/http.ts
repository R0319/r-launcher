import { z } from 'zod'
export interface Http {
  getJson<T>(
    url: string,
    schema: z.ZodType<T>,
    opts?: { timeoutMs?: number; headers?: Record<string, string> },
  ): Promise<T>
  postJson<T>(
    url: string,
    body: unknown,
    schema: z.ZodType<T>,
    opts?: { timeoutMs?: number },
  ): Promise<T>
  getBytes(
    url: string,
    opts: { maxBytes: number; allowedHosts?: readonly string[]; timeoutMs?: number },
  ): Promise<Buffer>
}
export class HttpError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}
export const DOWNLOAD_HOSTS: readonly string[] = [
  'cdn.modrinth.com',
  'edge.forgecdn.net',
  'mediafilez.forgecdn.net',
]
export function createHttp(opts: {
  fetch?: typeof fetch
  userAgent: string
  allowHttpLocalhost?: boolean
}): Http {
  const fetcher = opts.fetch ?? fetch
  async function request(
    url: string,
    init: RequestInit,
    maxBytes: number,
    timeoutMs = 15000,
    allowedHosts?: readonly string[],
  ): Promise<Buffer> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new HttpError('本文の上限が不正です')
    const controller = new AbortController()
    let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        void activeReader?.cancel().catch(() => {})
        reject(new HttpError('通信がタイムアウトしました'))
      }, timeoutMs)
    })
    const work = async (): Promise<Buffer> => {
      let current: URL
      try {
        current = new URL(url)
      } catch {
        throw new HttpError('URLが不正です')
      }
      let method = init.method ?? 'GET',
        body = init.body
      let headers = new Headers(init.headers)
      headers.set('User-Agent', opts.userAgent)
      for (let redirects = 0; ; redirects++) {
        if (controller.signal.aborted) throw new HttpError('通信がタイムアウトしました')
        if (
          current.username ||
          current.password ||
          (current.protocol !== 'https:' &&
            !(
              opts.allowHttpLocalhost &&
              current.protocol === 'http:' &&
              ['localhost', '127.0.0.1'].includes(current.hostname)
            ))
        )
          throw new HttpError('許可されていない通信先です')
        if (
          allowedHosts &&
          !allowedHosts.some((host) => host.toLowerCase() === current.hostname.toLowerCase())
        )
          throw new HttpError('許可されていないダウンロードホストです')
        const response = await fetcher(current.toString(), {
          ...init,
          method,
          body,
          headers,
          redirect: 'manual',
          signal: controller.signal,
        })
        if (controller.signal.aborted) {
          await response.body?.cancel()
          throw new HttpError('通信がタイムアウトしました')
        }
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          await response.body?.cancel()
          if (redirects >= 5) throw new HttpError('リダイレクト回数が上限を超えました')
          const location = response.headers.get('location')
          if (!location) throw new HttpError('リダイレクト先がありません')
          const next = new URL(location, current)
          if (next.origin !== current.origin) {
            headers = new Headers(headers)
            headers.delete('Authorization')
            headers.delete('Cookie')
          }
          if (
            response.status === 303 ||
            ((response.status === 301 || response.status === 302) && method === 'POST')
          ) {
            method = 'GET'
            body = undefined
            headers.delete('Content-Type')
          }
          current = next
          continue
        }
        if (!response.ok) {
          await response.body?.cancel()
          throw new HttpError(`HTTPエラー (${response.status})`, response.status)
        }
        const length = response.headers.get('content-length')
        if (length !== null && Number(length) > maxBytes) {
          await response.body?.cancel()
          throw new HttpError('本文が上限を超えています')
        }
        if (!response.body) return Buffer.alloc(0)
        const reader = response.body.getReader()
        activeReader = reader
        const chunks: Buffer[] = []
        let size = 0
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            size += value.byteLength
            if (size > maxBytes) {
              await reader.cancel()
              throw new HttpError('本文が上限を超えています')
            }
            chunks.push(Buffer.from(value))
          }
        } finally {
          activeReader = undefined
          reader.releaseLock()
        }
        return Buffer.concat(chunks, size)
      }
    }
    try {
      return await Promise.race([work(), timeout])
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw new HttpError(
        controller.signal.aborted ? '通信がタイムアウトしました' : '通信に失敗しました',
      )
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
  async function json<T>(
    url: string,
    schema: z.ZodType<T>,
    init: RequestInit,
    timeoutMs?: number,
  ): Promise<T> {
    const bytes = await request(url, init, 1024 * 1024, timeoutMs)
    try {
      return schema.parse(JSON.parse(bytes.toString('utf8')) as unknown)
    } catch {
      throw new HttpError('応答の形が想定と違います')
    }
  }
  return {
    getJson: (url, schema, options) =>
      json(url, schema, { headers: options?.headers }, options?.timeoutMs),
    postJson: (url, body, schema, options) =>
      json(
        url,
        schema,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        options?.timeoutMs,
      ),
    getBytes: (url, options) =>
      request(url, {}, options.maxBytes, options.timeoutMs, options.allowedHosts ?? DOWNLOAD_HOSTS),
  }
}
