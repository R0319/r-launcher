import 'dotenv/config'

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback
  if (value === undefined) {
    throw new Error(`環境変数 ${name} が設定されていません（.env を確認してください）`)
  }
  return value
}

// DB ドライバ: 'mysql'（本番/EC2）または 'file'（ローカル開発・JSON保存）。
const dbDriver = (process.env.DB_DRIVER ?? 'mysql') as 'mysql' | 'file'
// mysql モードのときだけ DB 認証情報を必須にする（file モードでは未設定でよい）。
const dbCred = (name: string): string =>
  dbDriver === 'mysql' ? required(name) : process.env[name] ?? ''

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  dbDriver,
  // file ドライバ時の players 保存先。
  dbFile: process.env.DB_FILE ?? './players.json',
  db: {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3306),
    user: dbCred('DB_USER'),
    password: dbCred('DB_PASSWORD'),
    database: dbCred('DB_NAME'),
  },
  modsDir: required('MODS_DIR', './mods_store'),
  discord: {
    clientId: process.env.DISCORD_CLIENT_ID ?? '',
    clientSecret: process.env.DISCORD_CLIENT_SECRET ?? '',
    redirectUri: process.env.DISCORD_REDIRECT_URI ?? '',
  },
  // /verify は未実装（トークン発行は廃止）。将来使うときのみ必須化する。
  verifyTokenSecret: process.env.VERIFY_TOKEN_SECRET ?? '',
  // マスター管理者の Minecraft UUID（完全固定）。管理画面から削除できず、
  // 管理者の追加/削除はこのマスターのみが行える。既定はオーナー(R0319)。
  masterUuids: (process.env.MASTER_UUIDS ?? '7400bf802aec4a43919cec2a215183aa')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0),
  // 追加の固定管理者 UUID（任意・env 由来。動的管理者は admins.json 側で管理）。
  adminUuids: (process.env.ADMIN_UUIDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0),
}
