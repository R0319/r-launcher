import * as net from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pingServer } from './serverPing'
const servers: net.Server[] = [],
  sockets: net.Socket[] = []
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy()
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  )
})
function vint(n: number): Buffer {
  const values: number[] = []
  do {
    let byte = n & 127
    n >>>= 7
    if (n) byte |= 128
    values.push(byte)
  } while (n)
  return Buffer.from(values)
}
function packet(body: Buffer): Buffer {
  return Buffer.concat([vint(body.length), body])
}
function length(buffer: Buffer): { n: number; bytes: number } | null {
  let n = 0
  for (let i = 0; i < buffer.length; i++) {
    const b = buffer[i]!
    n |= (b & 127) << (7 * i)
    if (!(b & 128)) return { n, bytes: i + 1 }
  }
  return null
}
async function server(
  handler: (socket: net.Socket, body: Buffer, count: number) => void,
): Promise<number> {
  const srv = net.createServer((socket) => {
    sockets.push(socket)
    socket.on('error', () => {})
    let buffer: Buffer = Buffer.alloc(0),
      count = 0
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      while (buffer.length) {
        const header = length(buffer)
        if (!header || buffer.length < header.n + header.bytes) break
        const body = buffer.subarray(header.bytes, header.bytes + header.n)
        buffer = buffer.subarray(header.bytes + header.n)
        handler(socket, body, count++)
      }
    })
  })
  servers.push(srv)
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve))
  const address = srv.address()
  if (!address || typeof address === 'string') throw new Error('address')
  return address.port
}
const status = (description: unknown): Buffer => {
  const json = Buffer.from(
    JSON.stringify({
      players: { online: 3, max: 20 },
      version: { name: '1.21', protocol: 767 },
      description,
    }),
  )
  return packet(Buffer.concat([Buffer.from([0]), vint(json.length), json]))
}
describe('Server List Ping', () => {
  it.each([false, true])('正常なHandshake、StatusとPong（分割=%s）', async (split) => {
    const port = await server((socket, body, count) => {
      if (count === 0) {
        expect(body[0]).toBe(0)
        expect(body.subarray(-1)[0]).toBe(1)
        expect(body.readUInt16BE(body.length - 3)).toBe(port)
      }
      if (count === 1) {
        expect(body).toEqual(Buffer.from([0]))
        const response = status('§aWelcome')
        if (split) {
          socket.write(response.subarray(0, 1))
          setTimeout(() => socket.write(response.subarray(1, 5)), 5)
          setTimeout(() => socket.write(response.subarray(5)), 10)
        } else socket.write(response)
      }
      if (count === 2) {
        expect(body[0]).toBe(1)
        socket.write(packet(body))
      }
    })
    const result = await pingServer('127.0.0.1', port)
    expect(result).toMatchObject({
      online: 3,
      max: 20,
      motd: 'Welcome',
      version: '1.21',
      protocol: 767,
    })
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
  })
  it('チャットコンポーネントと書式コード', async () => {
    const port = await server((socket, body, count) => {
      if (count === 1)
        socket.write(
          status({ text: '§bHello', extra: [{ text: ' world', extra: [{ text: '!' }] }] }),
        )
      if (count === 2) socket.write(packet(body))
    })
    expect((await pingServer('127.0.0.1', port)).motd).toBe('Hello world!')
  })
  it('タイムアウトとSRVのタイムアウト', async () => {
    const port = await server(() => {})
    await expect(pingServer('127.0.0.1', port, { timeoutMs: 30 })).rejects.toThrow('タイムアウト')
    await expect(
      pingServer('example.test', 25565, {
        timeoutMs: 20,
        resolveSrv: async () => new Promise(() => {}),
      }),
    ).rejects.toThrow('タイムアウト')
  })
  it.each(['json', 'large', 'varint', 'pong'])('壊れた応答を拒否 %s', async (kind) => {
    const port = await server((socket, body, count) => {
      if (count === 1)
        socket.write(
          kind === 'json'
            ? packet(Buffer.from([0, 1, 123]))
            : kind === 'large'
              ? vint(65537)
              : kind === 'varint'
                ? Buffer.from([255, 255, 255, 255, 255])
                : status('ok'),
        )
      if (count === 2) {
        const bad = Buffer.from(body)
        bad[1] = (bad[1] ?? 0) ^ 1
        socket.write(packet(bad))
      }
    })
    await expect(pingServer('127.0.0.1', port)).rejects.toThrow()
  })
  it('既定portだけSRVを検索し、失敗は無視', async () => {
    const port = await server((socket, body, count) => {
      if (count === 1) socket.write(status('ok'))
      if (count === 2) socket.write(packet(body))
    })
    const connect = vi.fn(() =>
      net.connect({ host: '127.0.0.1', port }),
    ) as unknown as typeof net.connect
    const resolveSrv = vi.fn(async () => ({ name: 'srv.test', port }))
    await pingServer('example.test', 25565, { connect, resolveSrv })
    expect(resolveSrv).toHaveBeenCalledWith('_minecraft._tcp.example.test')
    expect(connect).toHaveBeenCalledWith({ host: 'srv.test', port })
    resolveSrv.mockClear()
    await pingServer('127.0.0.1', port, { resolveSrv })
    expect(resolveSrv).not.toHaveBeenCalled()
    await pingServer('example.test', 25565, {
      connect,
      resolveSrv: async () => {
        throw new Error('no SRV')
      },
    })
  })
})
