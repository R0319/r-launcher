import 'dotenv/config'

export const config = {
  // 既定は本番(EC2/HTTPS)。開発時は .env の API_BASE_URL=http://localhost:3000 で上書きする。
  // 配布 .exe は .env を同梱しないため、この既定がそのまま使われる。
  apiBaseUrl: process.env.API_BASE_URL ?? 'https://52.194.80.48.sslip.io',
  discord: {
    // Client ID は公開情報。配布版でも使えるよう既定に焼き込む（Secret はサーバーのみが持つ）。
    clientId: process.env.DISCORD_CLIENT_ID ?? '1522932897013563523',
    // redirect_uri はランチャーが横取りするだけで実遷移しない。Discord Portal 登録値と一致必須。
    redirectUri: process.env.DISCORD_REDIRECT_URI ?? 'http://localhost:3000/auth/discord/callback',
    scope: process.env.DISCORD_OAUTH_SCOPE ?? 'identify',
  },
  mcServer: {
    host: process.env.MC_SERVER_HOST ?? '',
    port: Number(process.env.MC_SERVER_PORT ?? 25565),
  },
}
