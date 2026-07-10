import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import type { Modpack } from './types.js'

const modpacksFile = path.join(config.modsDir, 'modpacks.json')

const ID_RE = /^[a-z0-9-]+$/

export function isValidModpackId(id: string): boolean {
  return ID_RE.test(id)
}

export function modpackDir(id: string): string {
  return path.join(config.modsDir, id)
}

export async function listModpacks(): Promise<Modpack[]> {
  try {
    const raw = await readFile(modpacksFile, 'utf-8')
    return JSON.parse(raw) as Modpack[]
  } catch {
    return []
  }
}

export async function getModpack(id: string): Promise<Modpack | null> {
  const all = await listModpacks()
  return all.find((m) => m.id === id) ?? null
}

async function saveModpacks(list: Modpack[]): Promise<void> {
  if (!existsSync(config.modsDir)) await mkdir(config.modsDir, { recursive: true })
  await writeFile(modpacksFile, JSON.stringify(list, null, 2), 'utf-8')
}

export async function createModpack(mp: Modpack): Promise<void> {
  if (!isValidModpackId(mp.id)) {
    throw new Error('modpack id は英小文字・数字・ハイフンのみ使用できます')
  }
  const list = await listModpacks()
  if (list.some((m) => m.id === mp.id)) {
    throw new Error(`modpack id "${mp.id}" は既に存在します`)
  }
  // side ごとのディレクトリを用意
  for (const sub of ['required', 'client', 'client-optional', 'server']) {
    await mkdir(path.join(modpackDir(mp.id), sub), { recursive: true })
  }
  list.push(mp)
  await saveModpacks(list)
}

export async function updateModpack(id: string, patch: Partial<Omit<Modpack, 'id'>>): Promise<Modpack> {
  const list = await listModpacks()
  const idx = list.findIndex((m) => m.id === id)
  if (idx < 0) throw new Error(`modpack "${id}" が見つかりません`)
  list[idx] = { ...list[idx], ...patch }
  await saveModpacks(list)
  return list[idx]
}

export async function deleteModpack(id: string): Promise<void> {
  const list = await listModpacks()
  const next = list.filter((m) => m.id !== id)
  await saveModpacks(next)
  // MODファイルごとディレクトリを削除
  await rm(modpackDir(id), { recursive: true, force: true })
}
