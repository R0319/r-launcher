import nbt from 'prismarine-nbt'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

interface ServerEntry {
  name: { type: 'string'; value: string }
  ip: { type: 'string'; value: string }
  acceptTextures?: { type: 'byte'; value: number }
}

// Minecraft のサーバーリスト（servers.dat）に指定サーバーを登録する。
// 既に同じ ip が登録済みなら何もしない（重複回避）。非圧縮 big-endian NBT。
export function ensureServerRegistered(
  instanceRoot: string,
  host: string,
  port: number,
  displayName: string,
): void {
  const ip = port && port !== 25565 ? `${host}:${port}` : host
  const filePath = path.join(instanceRoot, 'servers.dat')

  let servers: ServerEntry[] = []
  if (existsSync(filePath)) {
    try {
      const buf = readFileSync(filePath)
      // parseUncompressed は同期。servers.dat は非圧縮。
      const parsed = nbt.parseUncompressed(buf, 'big') as any
      const list = parsed?.value?.servers?.value?.value
      if (Array.isArray(list)) servers = list as ServerEntry[]
    } catch {
      servers = []
    }
  }

  // 既に同じ ip があれば何もしない
  if (servers.some((s) => s.ip?.value === ip)) return

  servers.push({
    name: { type: 'string', value: displayName || host },
    ip: { type: 'string', value: ip },
    acceptTextures: { type: 'byte', value: 1 },
  })

  const data = {
    type: 'compound' as const,
    name: '',
    value: {
      servers: {
        type: 'list' as const,
        value: { type: 'compound' as const, value: servers },
      },
    },
  }
  const out = nbt.writeUncompressed(data as any, 'big')
  writeFileSync(filePath, out)
}
