import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createHttp, DOWNLOAD_HOSTS, HttpError } from './http'
const url = 'https://cdn.modrinth.com/a?token=SECRET'
function fake(handler: (url: string, init?: RequestInit) => Promise<Response>): typeof fetch {
  return vi.fn((input: string | URL | Request, init?: RequestInit) => handler(String(input), init))
}
describe('HTTP', () => {
  it('本文の待機中にタイムアウトしたらストリームを中止する', async () => {
    let canceled = false
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        canceled = true
      },
    })
    await expect(
      createHttp({ fetch: fake(async () => new Response(stream)), userAgent: 'x' }).getBytes(url, {
        maxBytes: 1,
        timeoutMs: 20,
      }),
    ).rejects.toThrow('タイムアウト')
    expect(canceled).toBe(true)
  })
  it('JSON、POST、User-Agent、schema検証', async () => {
    const fetch = fake(async (_url, init) => {
      expect(new Headers(init?.headers).get('User-Agent')).toBe('launcher')
      expect(init?.redirect).toBe('manual')
      if (init?.method === 'POST') expect(init.body).toBe('{"x":1}')
      return new Response('{"x":1}')
    })
    const http = createHttp({ fetch, userAgent: 'launcher' })
    expect(await http.getJson(url, z.object({ x: z.number() }))).toEqual({ x: 1 })
    expect(await http.postJson(url, { x: 1 }, z.object({ x: z.number() }))).toEqual({ x: 1 })
    await expect(http.getJson(url, z.string())).rejects.toThrow('応答の形が想定と違います')
  })
  it.each(['https://evil.example/file', 'http://cdn.modrinth.com/file'])(
    'リダイレクト先を毎回検証 %s',
    async (location) => {
      const fetch = fake(async () => new Response(null, { status: 302, headers: { location } }))
      await expect(
        createHttp({ fetch, userAgent: 'x' }).getBytes(url, { maxBytes: 10 }),
      ).rejects.toThrow()
      expect(fetch).toHaveBeenCalledTimes(1)
    },
  )
  it('相対リダイレクトと回数制限', async () => {
    let n = 0
    const fetch = fake(async () =>
      ++n === 1
        ? new Response(null, { status: 302, headers: { location: '/next' } })
        : new Response('ok'),
    )
    expect(
      (await createHttp({ fetch, userAgent: 'x' }).getBytes(url, { maxBytes: 2 })).toString(),
    ).toBe('ok')
    const loop = fake(
      async () => new Response(null, { status: 302, headers: { location: '/loop' } }),
    )
    await expect(
      createHttp({ fetch: loop, userAgent: 'x' }).getBytes(url, { maxBytes: 2 }),
    ).rejects.toThrow('リダイレクト回数')
    expect(loop).toHaveBeenCalledTimes(6)
  })
  it('宣言サイズとストリームの上限', async () => {
    let canceled = false
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(6))
      },
      cancel() {
        canceled = true
      },
    })
    await expect(
      createHttp({ fetch: fake(async () => new Response(stream)), userAgent: 'x' }).getBytes(url, {
        maxBytes: 5,
      }),
    ).rejects.toThrow('上限')
    expect(canceled).toBe(true)
    await expect(
      createHttp({
        fetch: fake(async () => new Response('large', { headers: { 'content-length': '100' } })),
        userAgent: 'x',
      }).getBytes(url, { maxBytes: 5 }),
    ).rejects.toThrow('上限')
  })
  it('fetchと本文読み込みのタイムアウト', async () => {
    for (const fetch of [
      fake(async () => new Promise<Response>(() => {})),
      fake(async () => new Response(new ReadableStream())),
    ])
      await expect(
        createHttp({ fetch, userAgent: 'x' }).getJson(url, z.unknown(), { timeoutMs: 20 }),
      ).rejects.toThrow('タイムアウト')
  })
  it('localhost例外とエラーのクエリ秘匿', async () => {
    const fetch = fake(async () => new Response('ok'))
    const http = createHttp({ fetch, userAgent: 'x', allowHttpLocalhost: true })
    expect(
      (
        await http.getBytes('http://127.0.0.1/a', { maxBytes: 2, allowedHosts: ['127.0.0.1'] })
      ).toString(),
    ).toBe('ok')
    await expect(
      http.getBytes('http://evil.example/a', { maxBytes: 2, allowedHosts: ['evil.example'] }),
    ).rejects.toThrow()
    const fail = createHttp({
      fetch: fake(async () => {
        throw new Error(url)
      }),
      userAgent: 'x',
    })
    try {
      await fail.getBytes(url, { maxBytes: 2 })
      throw new Error('unexpected')
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError)
      expect(String(error)).not.toContain('SECRET')
    }
    expect(DOWNLOAD_HOSTS).toHaveLength(3)
  })
})
