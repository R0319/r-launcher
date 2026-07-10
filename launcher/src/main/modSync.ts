import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fetchManifest, downloadFile } from './api'
import type { SyncProgress } from '../shared/types'

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

// MOD jar は「サーバーのマニフェストと一致」を強制する（仕様書3.4）。
// client_optional はランチャー利用者にも配布し、削除対象からも外す（サーバー側 rverify は
// これらをバージョン差込みで許可する）。config/ には一切触れない。
export async function syncMods(
  minecraftRoot: string,
  modpackId: string,
  onProgress: (progress: SyncProgress) => void,
): Promise<void> {
  onProgress({ phase: 'checking' })

  const modsDir = path.join(minecraftRoot, 'mods')
  if (!existsSync(modsDir)) mkdirSync(modsDir, { recursive: true })

  const manifest = await fetchManifest(modpackId)
  const clientEntries = manifest.mods.filter(
    (m) =>
      m.side === 'required_both' ||
      m.side === 'client_required' ||
      m.side === 'client_optional',
  )
  const wantedFileNames = new Set(clientEntries.map((m) => m.fileName))

  // 1. ローカルmods/を走査し、マニフェストに存在しないjarを無条件削除
  const localFiles = readdirSync(modsDir).filter((f) => f.endsWith('.jar'))
  for (const fileName of localFiles) {
    if (!wantedFileNames.has(fileName)) {
      onProgress({ phase: 'deleting', fileName })
      rmSync(path.join(modsDir, fileName))
    }
  }

  // 2. 不足 / ハッシュ不一致のMODをダウンロード
  let current = 0
  const total = clientEntries.length
  for (const entry of clientEntries) {
    current += 1
    const filePath = path.join(modsDir, entry.fileName)
    let needsDownload = true
    if (existsSync(filePath)) {
      const localHash = sha256(readFileSync(filePath))
      needsDownload = localHash !== entry.sha256
    }
    if (needsDownload) {
      onProgress({ phase: 'downloading', fileName: entry.fileName, current, total })
      const data = await downloadFile(entry.downloadUrl)
      // 改ざん防止: ダウンロードした内容の sha256 が manifest と一致することを検証してから配置。
      // 不一致なら破棄して中断（悪意ある差し替え jar の実行を防ぐ）。
      const gotHash = sha256(data)
      if (gotHash !== entry.sha256) {
        throw new Error(
          `MODの整合性チェックに失敗: ${entry.fileName}（期待 ${entry.sha256.slice(0, 12)}… / 実際 ${gotHash.slice(0, 12)}…）`,
        )
      }
      writeFileSync(filePath, data)
    }
  }

  onProgress({ phase: 'done' })
}
