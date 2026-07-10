import { BrowserWindow } from 'electron'
import { config } from './config'

// Discord OAuth の認可コード取得のみをここで行う。
// クライアントシークレットを使うcode交換は行わず、EC2側API（/auth/discord/callback）に
// codeを渡して交換させる（仕様書 8. セキュリティ: シークレットはランチャーに埋め込まない）。
export function getDiscordAuthCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const authWindow = new BrowserWindow({
      width: 480,
      height: 720,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    })

    const authorizeUrl =
      `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(config.discord.clientId)}` +
      `&redirect_uri=${encodeURIComponent(config.discord.redirectUri)}` +
      `&response_type=code&scope=${encodeURIComponent(config.discord.scope)}`

    authWindow.loadURL(authorizeUrl)

    let settled = false

    function settle(fn: () => void) {
      if (settled) return
      settled = true
      // resolve/reject を先に確定させてから、closed イベントの reject が
      // 後勝ちしないよう destroy する。
      fn()
      if (!authWindow.isDestroyed()) authWindow.destroy()
    }

    function handleUrl(url: string) {
      if (!url.startsWith(config.discord.redirectUri)) return
      const code = new URL(url).searchParams.get('code')
      const error = new URL(url).searchParams.get('error')
      if (code) {
        settle(() => resolve(code))
      } else {
        settle(() => reject(new Error(`Discord認可コードの取得に失敗しました${error ? `: ${error}` : ''}`)))
      }
    }

    // will-redirect: Discord の 302 リダイレクトを捕捉。コールバックURLなら
    // preventDefault でサーバーへの実リクエストを止め、code だけ取り出す。
    authWindow.webContents.on('will-redirect', (event, url) => {
      if (url.startsWith(config.discord.redirectUri)) event.preventDefault()
      handleUrl(url)
    })
    authWindow.webContents.on('will-navigate', (event, url) => {
      if (url.startsWith(config.discord.redirectUri)) event.preventDefault()
      handleUrl(url)
    })
    // did-start-navigation: リダイレクト/通常遷移を問わず確実に発火するフォールバック。
    authWindow.webContents.on('did-start-navigation', (_event, url) => handleUrl(url))

    authWindow.on('closed', () => {
      if (!settled) {
        settled = true
        reject(new Error('Discordログインがキャンセルされました'))
      }
    })
  })
}
