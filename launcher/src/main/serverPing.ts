import * as net from 'node:net'
import { promises as dns } from 'node:dns'
import { performance } from 'node:perf_hooks'
import { z } from 'zod'
export interface PingResult {
  online: number
  max: number
  motd: string
  version: string
  protocol: number
  latencyMs: number
}
function varInt(value: number): Buffer {
  const bytes: number[] = []
  do {
    let byte = value & 127
    value >>>= 7
    if (value) byte |= 128
    bytes.push(byte)
  } while (value)
  return Buffer.from(bytes)
}
function readVarInt(buffer: Buffer, offset = 0): { value: number; bytes: number } | null {
  let value = 0
  for (let i = 0; i < 5; i++) {
    const byte = buffer[offset + i]
    if (byte === undefined) return null
    if (i === 4 && byte & 0xf0) throw new Error('VarIntが不正です')
    value |= (byte & 127) << (7 * i)
    if (!(byte & 128)) return { value: value >>> 0, bytes: i + 1 }
  }
  throw new Error('VarIntが長すぎます')
}
function packet(body: Buffer): Buffer {
  return Buffer.concat([varInt(body.length), body])
}
function plainMotd(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(plainMotd).join('')
  if (!value || typeof value !== 'object') return ''
  const component = value as Record<string, unknown>
  return (
    (typeof component.text === 'string' ? component.text : '') +
    (Array.isArray(component.extra) ? component.extra.map(plainMotd).join('') : '')
  )
}
const statusSchema = z.object({
  players: z.object({
    online: z.number().int().nonnegative(),
    max: z.number().int().nonnegative(),
  }),
  version: z.object({ name: z.string(), protocol: z.number().int() }),
  description: z.unknown(),
})
export async function pingServer(
  host: string,
  port: number,
  opts?: {
    timeoutMs?: number
    resolveSrv?: (host: string) => Promise<{ name: string; port: number } | null>
    connect?: typeof net.connect
  },
): Promise<PingResult> {
  if (
    !host ||
    Buffer.byteLength(host) > 32767 ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw new Error('接続先が不正です')
  return new Promise<PingResult>((resolve, reject) => {
    let socket: net.Socket | undefined,
      finished = false
    const finish = (error?: Error, result?: PingResult): void => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      socket?.destroy()
      if (error) reject(error)
      else if (result) resolve(result)
    }
    const timer = setTimeout(
      () => finish(new Error('サーバー応答がタイムアウトしました')),
      opts?.timeoutMs ?? 5000,
    )
    void (async () => {
      let target = { name: host, port }
      if (port === 25565) {
        try {
          const srv = await (
            opts?.resolveSrv ??
            (async (name: string) => {
              const records = await dns.resolveSrv(name)
              return (
                records.sort((a, b) => a.priority - b.priority || b.weight - a.weight)[0] ?? null
              )
            })
          )(`_minecraft._tcp.${host}`)
          if (srv && srv.name && Number.isInteger(srv.port) && srv.port > 0 && srv.port <= 65535)
            target = srv
        } catch {
          /* SRVが無くても通常のホストへ接続する。 */
        }
      }
      if (finished) return
      socket = (opts?.connect ?? net.connect)({ host: target.name, port: target.port })
      const client = socket
      let pending: Buffer = Buffer.alloc(0),
        status: z.infer<typeof statusSchema> | undefined,
        sentAt = 0
      const payload = Buffer.alloc(8)
      payload.writeBigInt64BE(BigInt(Date.now()))
      client.on('error', (error) => finish(error))
      client.on('close', () => finish(new Error('応答前に接続が閉じられました')))
      client.on('connect', () => {
        const address = Buffer.from(host, 'utf8'),
          portBytes = Buffer.alloc(2)
        portBytes.writeUInt16BE(port)
        client.write(
          packet(
            Buffer.concat([
              varInt(0),
              varInt(-1),
              varInt(address.length),
              address,
              portBytes,
              varInt(1),
            ]),
          ),
        )
        client.write(packet(varInt(0)))
      })
      client.on('data', (chunk: Buffer) => {
        try {
          pending = Buffer.concat([pending, chunk])
          while (pending.length) {
            const length = readVarInt(pending)
            if (!length) break
            if (!length.value || length.value > 64 * 1024) throw new Error('応答サイズが不正です')
            if (pending.length < length.bytes + length.value) break
            const body = pending.subarray(length.bytes, length.bytes + length.value)
            pending = pending.subarray(length.bytes + length.value)
            const id = readVarInt(body)
            if (!id) throw new Error('パケットが不正です')
            if (!status) {
              if (id.value !== 0) throw new Error('Status応答が不正です')
              const jsonLength = readVarInt(body, id.bytes)
              if (!jsonLength || id.bytes + jsonLength.bytes + jsonLength.value !== body.length)
                throw new Error('JSONの長さが不正です')
              status = statusSchema.parse(
                JSON.parse(body.subarray(id.bytes + jsonLength.bytes).toString('utf8')) as unknown,
              )
              sentAt = performance.now()
              client.write(packet(Buffer.concat([varInt(1), payload])))
            } else {
              if (
                id.value !== 1 ||
                body.length !== id.bytes + 8 ||
                !body.subarray(id.bytes).equals(payload)
              )
                throw new Error('Pong応答が不正です')
              finish(undefined, {
                online: status.players.online,
                max: status.players.max,
                motd: plainMotd(status.description).replace(/§[0-9a-fk-orx]/gi, ''),
                version: status.version.name,
                protocol: status.version.protocol,
                latencyMs: performance.now() - sentAt,
              })
              return
            }
          }
          if (pending.length > 64 * 1024 + 5) throw new Error('応答が大きすぎます')
        } catch (error) {
          finish(error instanceof Error ? error : new Error('応答が不正です'))
        }
      })
    })().catch((error: unknown) =>
      finish(error instanceof Error ? error : new Error('接続に失敗しました')),
    )
  })
}
