import mysql from 'mysql2/promise'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { config } from './config.js'

export interface PlayerRow {
  uuid: string
  mcid: string
  discord_id: string
  created_at: Date
  updated_at: Date
}

// ===== MySQL/MariaDB ドライバ（本番・EC2） =====
// pool は遅延生成（file ドライバ時は接続を作らない）。
let _pool: mysql.Pool | null = null
function pool(): mysql.Pool {
  if (!_pool) {
    _pool = mysql.createPool({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      waitForConnections: true,
      connectionLimit: 10,
    })
  }
  return _pool
}

async function mysqlFind(uuid: string): Promise<PlayerRow | null> {
  const [rows] = await pool().query<mysql.RowDataPacket[]>(
    'SELECT * FROM players WHERE uuid = ? LIMIT 1',
    [uuid],
  )
  return (rows[0] as PlayerRow) ?? null
}

async function mysqlUpsert(uuid: string, mcid: string, discordId: string): Promise<void> {
  await pool().query(
    `INSERT INTO players (uuid, mcid, discord_id) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE mcid = VALUES(mcid)`,
    [uuid, mcid, discordId],
  )
}

// ===== ファイルドライバ（ローカル開発用・DB_DRIVER=file） =====
// MariaDB を入れずに players を JSON ファイルへ保存する。本番では使わない。
interface FileRecord {
  uuid: string
  mcid: string
  discord_id: string
  created_at: string
  updated_at: string
}

function dbFilePath(): string {
  return path.resolve(config.dbFile)
}

async function readAll(): Promise<FileRecord[]> {
  try {
    return JSON.parse(await readFile(dbFilePath(), 'utf-8')) as FileRecord[]
  } catch {
    return []
  }
}

async function writeAll(list: FileRecord[]): Promise<void> {
  await writeFile(dbFilePath(), JSON.stringify(list, null, 2), 'utf-8')
}

function toRow(r: FileRecord): PlayerRow {
  return {
    uuid: r.uuid,
    mcid: r.mcid,
    discord_id: r.discord_id,
    created_at: new Date(r.created_at),
    updated_at: new Date(r.updated_at),
  }
}

async function fileFind(uuid: string): Promise<PlayerRow | null> {
  const rec = (await readAll()).find((r) => r.uuid === uuid)
  return rec ? toRow(rec) : null
}

async function fileUpsert(uuid: string, mcid: string, discordId: string): Promise<void> {
  const list = await readAll()
  const now = new Date().toISOString()
  const existing = list.find((r) => r.uuid === uuid)
  if (existing) {
    // 本番の ON DUPLICATE KEY UPDATE mcid=VALUES(mcid) と同じく mcid のみ更新。
    existing.mcid = mcid
    existing.updated_at = now
  } else {
    list.push({ uuid, mcid, discord_id: discordId, created_at: now, updated_at: now })
  }
  await writeAll(list)
}

// ===== ドライバ選択 =====
const useFile = config.dbDriver === 'file'

export const findPlayerByUuid = useFile ? fileFind : mysqlFind
export const upsertPlayer = useFile ? fileUpsert : mysqlUpsert
