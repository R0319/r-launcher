import type { FastifyInstance } from 'fastify'
import { config } from '../config.js'
import { upsertPlayer } from '../db.js'
import { resolveMcIdentity, normalizeUuid } from '../adminAuth.js'

interface DiscordCallbackBody {
  code: string
  uuid: string
  mcid: string
  // 送信者が本当にその Minecraft アカウント本人かを検証するための MS アクセストークン。
  msAccessToken: string
}

interface DiscordTokenResponse {
  access_token: string
  token_type: string
}

interface DiscordUser {
  id: string
  username: string
  global_name: string | null
}

export default async function authRoute(app: FastifyInstance) {
  app.post<{ Body: DiscordCallbackBody }>('/auth/discord/callback', async (req, reply) => {
    const { code, uuid, mcid, msAccessToken } = req.body ?? {}
    if (!code || !uuid || !mcid || !msAccessToken) {
      return reply.status(400).send({ error: 'missing_params' })
    }
    if (!config.discord.clientId || !config.discord.clientSecret) {
      return reply.status(500).send({ error: 'discord_oauth_not_configured' })
    }

    // 成りすまし防止: 送られてきた uuid が、その MS トークンの本人のものか検証する。
    const identity = await resolveMcIdentity(msAccessToken)
    if (!identity || identity.uuid !== normalizeUuid(uuid)) {
      return reply.status(403).send({ error: 'account_verification_failed' })
    }

    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.discord.clientId,
        client_secret: config.discord.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.discord.redirectUri,
      }),
    })
    if (!tokenRes.ok) {
      app.log.error({ body: await tokenRes.text() }, 'Discord トークン交換に失敗')
      return reply.status(502).send({ error: 'discord_token_exchange_failed' })
    }
    const token = (await tokenRes.json()) as DiscordTokenResponse

    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `${token.token_type} ${token.access_token}` },
    })
    if (!userRes.ok) {
      return reply.status(502).send({ error: 'discord_user_fetch_failed' })
    }
    const discordUser = (await userRes.json()) as DiscordUser
    const discordName = discordUser.global_name ?? discordUser.username

    // mcid はクライアント申告ではなくトークンから解決した正規の名前を保存する。
    await upsertPlayer(uuid, identity.name, discordUser.id)

    return { uuid, mcid: identity.name, discordId: discordUser.id, discordName }
  })
}
