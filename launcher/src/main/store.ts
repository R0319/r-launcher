// 設定とアカウントの保存。アカウントのトークンは OS の暗号化（safeStorage）を通してから書く。
// 暗号化が使えない環境では、トークンをディスクに書かない（起動のたびにログインし直す）。
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Account } from 'eml-lib'
import { parseSettings, type Settings } from '../shared/settings'

export interface Cipher {
  available(): boolean
  encrypt(plain: string): string
  decrypt(cipher: string): string
}

export interface StoredData {
  setupCompleted: boolean
  settings: Settings
  account: Account | null
  discord: { name: string } | null
}

interface RawFile {
  version?: unknown
  setupCompleted?: unknown
  settings?: unknown
  account?: unknown
  discord?: unknown
}

const TOKEN_FIELDS = ['accessToken', 'refreshToken', 'clientToken'] as const

export class Store {
  private memoryAccount: Account | null = null

  constructor(
    private readonly dir: string,
    private readonly cipher: Cipher,
  ) {}

  private get file() {
    return path.join(this.dir, 'store.json')
  }

  load(): StoredData {
    const raw = this.readRaw()
    if (raw.version !== 2) {
      const old = migrateV1(raw as Record<string, unknown>)
      return {
        setupCompleted: old.setupCompleted ?? false,
        settings: old.settings ?? parseSettings({}),
        account: this.memoryAccount,
        discord: old.discord ?? null,
      }
    }
    return {
      setupCompleted: raw.setupCompleted === true,
      settings: parseSettings(raw.settings),
      account: this.memoryAccount ?? this.decodeAccount(raw.account),
      discord: decodeDiscord(raw.discord),
    }
  }

  save(data: StoredData): void {
    // 暗号化できないときはメモリにだけ持つ
    this.memoryAccount = this.cipher.available() ? null : data.account
    const out = {
      version: 2,
      setupCompleted: data.setupCompleted,
      settings: data.settings,
      account: this.cipher.available() ? this.encodeAccount(data.account) : null,
      discord: data.discord,
    }
    mkdirSync(this.dir, { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(out, null, 2), { encoding: 'utf-8', mode: 0o600 })
    renameSync(tmp, this.file)
  }

  update(fn: (data: StoredData) => StoredData): StoredData {
    const next = fn(this.load())
    this.save(next)
    return next
  }

  private readRaw(): RawFile {
    if (!existsSync(this.file)) return {}
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.file, 'utf-8'))
      return parsed && typeof parsed === 'object' ? (parsed as RawFile) : {}
    } catch (error) {
      console.error('[store] store.json を読めません。初期値で続けます', (error as Error).message)
      return {}
    }
  }

  private encodeAccount(account: Account | null): unknown {
    if (!account) return null
    const copy: Record<string, unknown> = { ...account }
    for (const field of TOKEN_FIELDS) {
      const value = copy[field]
      if (typeof value === 'string' && value) copy[field] = `enc:${this.cipher.encrypt(value)}`
    }
    return copy
  }

  private decodeAccount(raw: unknown): Account | null {
    if (!raw || typeof raw !== 'object') return null
    const copy: Record<string, unknown> = { ...(raw as Record<string, unknown>) }
    if (typeof copy.name !== 'string' || typeof copy.uuid !== 'string') return null
    for (const field of TOKEN_FIELDS) {
      const value = copy[field]
      if (typeof value !== 'string' || !value) continue
      // 旧版（v1）は暗号化できない環境で平文を保存していた。平文のトークンは信用せず捨てる
      if (!value.startsWith('enc:') || !this.cipher.available()) return null
      try {
        copy[field] = this.cipher.decrypt(value.slice(4))
      } catch {
        return null
      }
    }
    return copy as unknown as Account
  }
}

function decodeDiscord(raw: unknown): { name: string } | null {
  if (!raw || typeof raw !== 'object') return null
  const name = (raw as { name?: unknown }).name
  return typeof name === 'string' && name.length <= 100 ? { name } : null
}

/** v1（r-launcher 1.x）の store.json から引き継げるものを読む */
export function migrateV1(raw: Record<string, unknown>): Partial<StoredData> {
  const settings = raw.settings as Record<string, unknown> | undefined
  const out: Partial<StoredData> = {}
  if (raw.setupCompleted === true) out.setupCompleted = true
  if (settings && typeof settings === 'object') {
    const java: Record<string, unknown> = {}
    if (typeof settings.memoryMaxMb === 'number') java.memoryMaxMb = settings.memoryMaxMb
    if (typeof settings.memoryMinMb === 'number') java.memoryMinMb = settings.memoryMinMb
    out.settings = parseSettings({
      instanceBaseDir:
        typeof settings.instanceBaseDir === 'string' ? settings.instanceBaseDir : null,
      java,
    })
  }
  if (typeof raw.discordName === 'string') out.discord = { name: raw.discordName }
  return out
}
