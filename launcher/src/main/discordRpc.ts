import * as net from 'node:net'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
export interface Activity {
  details?: string
  state?: string
  startTimestamp?: number
  largeImageKey?: string
  largeImageText?: string
}
function frame(op: number, data: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(data)),
    header = Buffer.alloc(8)
  header.writeInt32LE(op)
  header.writeInt32LE(body.length, 4)
  return Buffer.concat([header, body])
}
export class DiscordRpc {
  private socket?: net.Socket
  private handshakeSocket?: net.Socket
  private connecting?: Promise<boolean>
  private generation = 0
  private pending = new Map<string, (success: boolean) => void>()
  constructor(
    private readonly opts: {
      clientId: string
      pipePath?: (index: number) => string
      connect?: typeof net.connect
    },
  ) {}
  connect(): Promise<boolean> {
    if (this.socket && !this.socket.destroyed) return Promise.resolve(true)
    if (this.connecting) return this.connecting
    const generation = this.generation
    this.connecting = (async () => {
      for (let index = 0; index < 10 && generation === this.generation; index++)
        if (await this.attempt(index, generation)) return true
      return false
    })()
      .catch(() => false)
      .finally(() => {
        this.connecting = undefined
      })
    return this.connecting
  }
  private attempt(index: number, generation: number): Promise<boolean> {
    return new Promise((resolve) => {
      let socket: net.Socket
      try {
        const pipe =
          this.opts.pipePath?.(index) ??
          (process.platform === 'win32'
            ? `\\\\?\\pipe\\discord-ipc-${index}`
            : path.join(
                process.env.XDG_RUNTIME_DIR ?? process.env.TMPDIR ?? '/tmp',
                `discord-ipc-${index}`,
              ))
        socket = (this.opts.connect ?? net.connect)(pipe)
        this.handshakeSocket = socket
      } catch {
        resolve(false)
        return
      }
      let ready = false,
        settled = false,
        buffer: Buffer = Buffer.alloc(0)
      const timer = setTimeout(() => fail(), 1000)
      const settle = (success: boolean): void => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          resolve(success)
        }
      }
      const fail = (): void => {
        if (this.handshakeSocket === socket) this.handshakeSocket = undefined
        if (this.socket === socket) {
          this.socket = undefined
          for (const complete of this.pending.values()) complete(false)
          this.pending.clear()
        }
        socket.destroy()
        settle(false)
      }
      socket.on('error', fail)
      socket.on('close', fail)
      socket.on('connect', () => {
        if (generation !== this.generation) {
          fail()
          return
        }
        socket.write(frame(0, { v: 1, client_id: this.opts.clientId }))
      })
      socket.on('data', (chunk: Buffer) => {
        try {
          buffer = Buffer.concat([buffer, chunk])
          while (buffer.length >= 8) {
            const op = buffer.readInt32LE(0),
              length = buffer.readInt32LE(4)
            if (length < 0 || length > 64 * 1024) {
              fail()
              return
            }
            if (buffer.length < length + 8) break
            const body = buffer.subarray(8, 8 + length)
            buffer = buffer.subarray(8 + length)
            if (op === 2) {
              fail()
              return
            }
            if (op === 3) {
              socket.write(frame(4, JSON.parse(body.toString('utf8')) as unknown))
              continue
            }
            if (op !== 1) continue
            const data: unknown = JSON.parse(body.toString('utf8'))
            if (!data || typeof data !== 'object') {
              fail()
              return
            }
            const message = data as Record<string, unknown>
            if (!ready) {
              if (message.evt !== 'READY' || generation !== this.generation) {
                fail()
                return
              }
              ready = true
              this.handshakeSocket = undefined
              this.socket = socket
              settle(true)
            } else if (typeof message.nonce === 'string')
              this.pending.get(message.nonce)?.(message.evt !== 'ERROR')
          }
          if (buffer.length > 64 * 1024 + 8) fail()
        } catch {
          fail()
        }
      })
    })
  }
  setActivity(activity: Activity | null): Promise<boolean> {
    const socket = this.socket
    if (!socket || socket.destroyed) return Promise.resolve(false)
    const nonce = randomUUID(),
      trim = (value?: string): string | undefined => value?.slice(0, 128)
    const mapped =
      activity === null
        ? null
        : {
            details: trim(activity.details),
            state: trim(activity.state),
            timestamps:
              activity.startTimestamp === undefined
                ? undefined
                : { start: activity.startTimestamp },
            assets: {
              large_image: trim(activity.largeImageKey),
              large_text: trim(activity.largeImageText),
            },
          }
    return new Promise((resolve) => {
      const timer = setTimeout(() => complete(false), 1000)
      const complete = (success: boolean): void => {
        clearTimeout(timer)
        this.pending.delete(nonce)
        resolve(success)
      }
      this.pending.set(nonce, complete)
      try {
        socket.write(
          frame(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: mapped }, nonce }),
          (error) => {
            if (error) complete(false)
          },
        )
      } catch {
        complete(false)
      }
    })
  }
  close(): void {
    this.generation++
    this.handshakeSocket?.destroy()
    this.handshakeSocket = undefined
    this.socket?.destroy()
    this.socket = undefined
    for (const complete of this.pending.values()) complete(false)
    this.pending.clear()
  }
}
