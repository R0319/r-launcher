import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { modpackDir } from './modpackStore.js'
import type { ModrinthModEntry } from './modrinth.js'

// modpack ごとに「Modrinth CDN 配布の MOD」を記録するファイル。
// これらは EC2 に保存せず、manifest では CDN URL をそのまま配る（料金最適化）。
function file(modpackId: string): string {
  return path.join(modpackDir(modpackId), 'modrinth.json')
}

export async function getModrinthMods(modpackId: string): Promise<ModrinthModEntry[]> {
  try {
    return JSON.parse(await readFile(file(modpackId), 'utf-8')) as ModrinthModEntry[]
  } catch {
    return []
  }
}

async function save(modpackId: string, list: ModrinthModEntry[]): Promise<void> {
  await writeFile(file(modpackId), JSON.stringify(list, null, 2), 'utf-8')
}

// エントリを追加（fileName で重複排除）。
export async function addModrinthMods(
  modpackId: string,
  entries: ModrinthModEntry[],
): Promise<void> {
  const existing = await getModrinthMods(modpackId)
  const byName = new Map(existing.map((e) => [e.fileName, e]))
  for (const e of entries) byName.set(e.fileName, e)
  await save(modpackId, [...byName.values()])
}

// fileName を削除。削除できたら true。
export async function removeModrinthMod(modpackId: string, fileName: string): Promise<boolean> {
  const existing = await getModrinthMods(modpackId)
  const next = existing.filter((e) => e.fileName !== fileName)
  if (next.length === existing.length) return false
  await save(modpackId, next)
  return true
}
