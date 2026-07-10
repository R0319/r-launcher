import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import type { Account } from 'eml-lib'

export interface StoredData {
  account?: Account
  discordId?: string
  discordName?: string
  // 初回セットアップ（保存先の選択）が完了したか。false の間は初回セットアップ画面を出す。
  setupCompleted?: boolean
  // 最後に選択した modpack の id（次回起動時に復元）。
  selectedModpackId?: string
  settings: {
    memoryMaxMb: number
    memoryMinMb: number
    // ゲームデータの親フォルダ。実際のゲームルートは <instanceBaseDir>/.r-launcher。
    // 既定は本来の %APPDATA%（一般的なMinecraftランチャーと同じ場所）。
    instanceBaseDir: string
    logDir: string
  }
}

function defaultData(): StoredData {
  return {
    setupCompleted: false,
    settings: {
      memoryMaxMb: 4096,
      memoryMinMb: 512,
      instanceBaseDir: app.getPath('appData'),
      logDir: path.join(app.getPath('userData'), 'logs'),
    },
  }
}

function storeFilePath(): string {
  return path.join(app.getPath('userData'), 'store.json')
}

// Microsoft/Discord トークンは safeStorage（OSキーチェーン連携）で暗号化してから
// JSONに保存する。平文でディスクに置かない（仕様書 8. セキュリティ）。
function encrypt(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) return value
  return safeStorage.encryptString(value).toString('base64')
}

function decrypt(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) return value
  try {
    return safeStorage.decryptString(Buffer.from(value, 'base64'))
  } catch {
    return value
  }
}

export function loadStore(): StoredData {
  const file = storeFilePath()
  if (!existsSync(file)) return defaultData()
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as StoredData
    if (raw.account) {
      raw.account.accessToken = decrypt(raw.account.accessToken)
      if (raw.account.refreshToken) raw.account.refreshToken = decrypt(raw.account.refreshToken)
    }
    return { ...defaultData(), ...raw, settings: { ...defaultData().settings, ...raw.settings } }
  } catch {
    return defaultData()
  }
}

export function saveStore(data: StoredData): void {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const toSave: StoredData = {
    ...data,
    account: data.account
      ? {
          ...data.account,
          accessToken: encrypt(data.account.accessToken),
          refreshToken: data.account.refreshToken ? encrypt(data.account.refreshToken) : undefined,
        }
      : undefined,
  }
  writeFileSync(storeFilePath(), JSON.stringify(toSave, null, 2), 'utf-8')
}
