// mods_store/<modpackId>/{required,client,server}/*.jar を走査し
// mods_store/<modpackId>/manifest.json を再生成する。
// side の割り当てはディレクトリで手動管理する（仕様書5.2で確定）。
import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { modpackDir } from './modpackStore.js'
import { getModrinthMods } from './modrinthStore.js'
import type { Manifest, ManifestEntry, ModSide } from './types.js'

export const SIDE_DIRS: Record<ModSide, string> = {
  required_both: 'required',
  client_required: 'client',
  client_optional: 'client-optional',
  server_only: 'server',
}

const BASE_URL = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000'

async function sha256File(filePath: string): Promise<string> {
  const buf = await readFile(filePath)
  return createHash('sha256').update(buf).digest('hex')
}

async function scanSide(modpackId: string, side: ModSide): Promise<ManifestEntry[]> {
  const dir = path.join(modpackDir(modpackId), SIDE_DIRS[side])
  let files: string[]
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.jar'))
  } catch {
    return []
  }

  const entries: ManifestEntry[] = []
  for (const fileName of files) {
    const filePath = path.join(dir, fileName)
    const sha256 = await sha256File(filePath)
    entries.push({
      modId: fileName.replace(/\.jar$/, ''),
      fileName,
      sha256,
      downloadUrl:
        side === 'server_only'
          ? ''
          : `${BASE_URL}/modpacks/${modpackId}/mods/${encodeURIComponent(fileName)}`,
      side,
    })
  }
  return entries
}

// Modrinth 経由で導入した MOD（EC2 非保存・CDN 直配布）を manifest エントリ化。
async function modrinthEntries(modpackId: string): Promise<ManifestEntry[]> {
  const list = await getModrinthMods(modpackId)
  return list.map((e) => ({
    modId: e.fileName.replace(/\.jar$/, ''),
    fileName: e.fileName,
    sha256: e.sha256,
    downloadUrl: e.side === 'server_only' ? '' : e.cdnUrl,
    side: e.side,
  }))
}

// 指定 modpack の manifest.json を再生成して書き出し、生成したマニフェストを返す。
export async function regenerateManifest(modpackId: string): Promise<Manifest> {
  const mods = [
    ...(await scanSide(modpackId, 'required_both')),
    ...(await scanSide(modpackId, 'client_required')),
    ...(await scanSide(modpackId, 'client_optional')),
    ...(await scanSide(modpackId, 'server_only')),
    ...(await modrinthEntries(modpackId)),
  ]

  const manifest: Manifest = {
    generatedAt: new Date().toISOString(),
    mods,
  }

  const outPath = path.join(modpackDir(modpackId), 'manifest.json')
  await writeFile(outPath, JSON.stringify(manifest, null, 2), 'utf-8')
  return manifest
}
