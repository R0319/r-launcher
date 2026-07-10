import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { config } from './config.js'

// 動的に追加した管理者を保存するファイル（マスターは config.masterUuids で固定・ここには入れない）。
const adminsFile = path.join(config.modsDir, 'admins.json')

export interface AdminRecord {
  uuid: string // ハイフン無し・小文字
  mcid: string // 追加時点の Minecraft ユーザー名
  addedBy: string // 追加したマスターの mcid
  addedAt: string // ISO
}

export async function listAdmins(): Promise<AdminRecord[]> {
  try {
    return JSON.parse(await readFile(adminsFile, 'utf-8')) as AdminRecord[]
  } catch {
    return []
  }
}

async function save(list: AdminRecord[]): Promise<void> {
  if (!existsSync(config.modsDir)) await mkdir(config.modsDir, { recursive: true })
  await writeFile(adminsFile, JSON.stringify(list, null, 2), 'utf-8')
}

// uuid（ハイフン無し・小文字）で追加。既に存在すれば false。
export async function addAdmin(rec: AdminRecord): Promise<boolean> {
  const list = await listAdmins()
  if (list.some((a) => a.uuid === rec.uuid)) return false
  list.push(rec)
  await save(list)
  return true
}

// uuid で削除。削除できたら true。
export async function removeAdmin(uuid: string): Promise<boolean> {
  const list = await listAdmins()
  const next = list.filter((a) => a.uuid !== uuid)
  if (next.length === list.length) return false
  await save(next)
  return true
}
