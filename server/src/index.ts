import Fastify from 'fastify'
import cors from '@fastify/cors'
import { config } from './config.js'
import modpacksRoute from './routes/modpacks.js'
import playerRoute from './routes/player.js'
import authRoute from './routes/auth.js'
import adminRoute from './routes/admin.js'

// MODアップロードは base64 JSON で受けるため body 上限を引き上げる（最大 100MB）。
const app = Fastify({ logger: true, bodyLimit: 100 * 1024 * 1024 })

// クライアントは Electron メインプロセスと Java(rverify) でブラウザではないため CORS 不要。
// 任意オリジンからのブラウザ経由アクセスを許さないよう無効化する。
await app.register(cors, { origin: false })
await app.register(modpacksRoute)
await app.register(playerRoute)
await app.register(authRoute)
await app.register(adminRoute)

app.get('/health', async () => ({ ok: true }))

try {
  await app.listen({ port: config.port, host: config.host })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
