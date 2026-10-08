import * as net from 'node:net'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DiscordRpc } from './discordRpc'
let dir: string
const servers: net.Server[] = [],
  sockets: net.Socket[] = [],
  clients: DiscordRpc[] = []
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'launcher-rpc-'))
})
afterEach(async () => {
  clients.splice(0).forEach((client) => client.close())
  sockets.splice(0).forEach((socket) => socket.destroy())
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  )
  await fs.rm(dir, { recursive: true, force: true })
})
function pipe(index: number): string {
  return process.platform === 'win32'
    ? `\\\\?\\pipe\\launcher-test-${path.basename(dir)}-${index}`
    : path.join(dir, `discord-ipc-${index}`)
}
function frame(op: number, data: unknown): Buffer {
  const bytes = Buffer.from(JSON.stringify(data)),
    header = Buffer.alloc(8)
  header.writeInt32LE(op)
  header.writeInt32LE(bytes.length, 4)
  return Buffer.concat([header, bytes])
}
async function server(
  index: number,
  handler: (socket: net.Socket, op: number, data: Record<string, unknown>) => void,
): Promise<void> {
  const srv = net.createServer((socket) => {
    sockets.push(socket)
    socket.on('error', () => {})
    let buffer: Buffer = Buffer.alloc(0)
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      while (buffer.length >= 8) {
        const op = buffer.readInt32LE(),
          size = buffer.readInt32LE(4)
        if (buffer.length < size + 8) break
        const data = JSON.parse(buffer.subarray(8, size + 8).toString()) as Record<string, unknown>
        buffer = buffer.subarray(size + 8)
        handler(socket, op, data)
      }
    })
  })
  servers.push(srv)
  await new Promise<void>((resolve) => srv.listen(pipe(index), resolve))
}
function client(): DiscordRpc {
  const rpc = new DiscordRpc({ clientId: '12345', pipePath: pipe })
  clients.push(rpc)
  return rpc
}
describe('Discord RPC', () => {
  it('ハンドシェイク中のcloseで接続を中止する', async () => {
    await server(0, () => {})
    const rpc = client()
    const connecting = rpc.connect()
    await new Promise((resolve) => setTimeout(resolve, 20))
    rpc.close()
    expect(await connecting).toBe(false)
    expect(await rpc.setActivity({})).toBe(false)
  })
  it('順番にパイプを試し、分割READYとSET_ACTIVITYを送受信', async () => {
    const messages: Record<string, unknown>[] = []
    await server(2, (socket, op, data) => {
      if (op === 0) {
        expect(data).toEqual({ v: 1, client_id: '12345' })
        const ready = frame(1, { evt: 'READY' })
        socket.write(ready.subarray(0, 4))
        setTimeout(() => socket.write(ready.subarray(4)), 5)
      } else {
        messages.push(data)
        socket.write(frame(1, { cmd: 'SET_ACTIVITY', nonce: data.nonce, evt: null }))
      }
    })
    const rpc = client()
    expect(await rpc.connect()).toBe(true)
    expect(await rpc.connect()).toBe(true)
    expect(
      await rpc.setActivity({
        details: 'x'.repeat(200),
        state: 'Playing',
        startTimestamp: 123,
        largeImageKey: 'minecraft',
        largeImageText: 'y'.repeat(200),
      }),
    ).toBe(true)
    const request = messages[0]!
    expect(request.cmd).toBe('SET_ACTIVITY')
    expect(request.nonce).toBeTypeOf('string')
    expect(request.args).toEqual({
      pid: process.pid,
      activity: {
        details: 'x'.repeat(128),
        state: 'Playing',
        timestamps: { start: 123 },
        assets: { large_image: 'minecraft', large_text: 'y'.repeat(128) },
      },
    })
    expect(await rpc.setActivity(null)).toBe(true)
    expect(messages[1]?.args).toEqual({ pid: process.pid, activity: null })
    rpc.close()
    expect(await rpc.setActivity({})).toBe(false)
  })
  it('Discordが無いときはfalse', async () => {
    const rpc = client()
    expect(await rpc.connect()).toBe(false)
    expect(await rpc.setActivity({})).toBe(false)
  })
  it('切断時とERROR応答はfalse', async () => {
    await server(0, (socket, op, data) => {
      if (op === 0) socket.write(frame(1, { evt: 'READY' }))
      else socket.write(frame(1, { evt: 'ERROR', nonce: data.nonce }))
    })
    const rpc = client()
    expect(await rpc.connect()).toBe(true)
    expect(await rpc.setActivity({})).toBe(false)
    sockets[0]?.destroy()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(await rpc.setActivity({})).toBe(false)
  })
  it('不正なフレームを受けても例外を投げない', async () => {
    await server(0, (socket) => {
      const invalid = Buffer.alloc(8)
      invalid.writeInt32LE(1)
      invalid.writeInt32LE(65537, 4)
      socket.write(invalid)
    })
    expect(await client().connect()).toBe(false)
  })
})
