// 配布版に焼き込む値。開発時は .env で上書きできる（.env は配布物に含めない）。
import 'dotenv/config'

const env = (name: string) => {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

export const config = {
  /**
   * Microsoft ログインの Client ID。未設定なら eml-lib の既定（公式ランチャーの ID）を使う。
   * 自前の Azure アプリを Mojang の審査（aka.ms/mce-reviewappid）に通したら、ここに入れて切り替える。
   */
  msaClientId: env('MSA_CLIENT_ID'),
  /** Discord のアプリ ID（Rich Presence 用。公開情報） */
  discordAppId: env('DISCORD_APP_ID') ?? '1522932897013563523',
  /** 開発用に http://localhost の Panel を許すか（配布版では常に false） */
  allowHttpLocalhost: env('ALLOW_HTTP_LOCALHOST') === '1',
  userAgent: 'R0319/r-launcher/2.0 (+https://github.com/R0319/r-launcher)',
}
