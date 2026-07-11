import { app, type BrowserWindow } from 'electron'
// electron-updater は CommonJS モジュールで default エクスポートを持たないため、
// 名前付きインポートで取得する（default インポートだと autoUpdater が undefined になり起動時クラッシュ）。
import { autoUpdater } from 'electron-updater'

// 自動更新の状態をレンダラーへ通知する型（renderer と共有）。
export type UpdateStatus =
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'none' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }

// GitHub Releases を更新元に、起動時チェック→自動DL→ダウンロード完了で通知。
// 実際の適用（再起動）はユーザー操作（update:install）またはアプリ終了時に行う。
export function initAutoUpdater(getWindow: () => BrowserWindow | undefined): void {
  // 開発時（未パッケージ）は更新メタデータが無いので動かさない。
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  const send = (status: UpdateStatus) => {
    const w = getWindow()
    if (w && !w.isDestroyed()) w.webContents.send('update:status', status)
  }

  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => send({ state: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => send({ state: 'none' }))
  autoUpdater.on('download-progress', (p) =>
    send({ state: 'downloading', percent: Math.round(p.percent) }),
  )
  autoUpdater.on('update-downloaded', (info) =>
    send({ state: 'downloaded', version: info.version }),
  )
  autoUpdater.on('error', (err) =>
    send({ state: 'error', message: String((err as Error)?.message ?? err) }),
  )

  autoUpdater.checkForUpdates().catch((err) => {
    console.error('[updater] checkForUpdates failed', err)
  })
}

// ダウンロード済みの更新を適用してアプリを再起動する。
export function quitAndInstall(): void {
  autoUpdater.quitAndInstall()
}
