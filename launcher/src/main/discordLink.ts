// Discord 連携（mc-panel の docs/launcher-api.md §3）。
// Minecraft のアクセストークンは Panel に送らない。Mojang のセッションサーバーに「join」を送り、
// Panel が hasJoined で本人確認する（マルチプレイの接続と同じ仕組み）。
import type { PanelClient } from './panel'

const JOIN_URL = 'https://sessionserver.mojang.com/session/minecraft/join'

export interface LinkAccount {
  name: string
  uuid: string
  accessToken: string
}

export interface LinkDeps {
  panel: PanelClient
  fetch: typeof fetch
  openExternal: (url: string) => Promise<void>
  sleep?: (ms: number) => Promise<void>
  /** 利用者がブラウザで許可するまで待つ時間 */
  timeoutMs?: number
}

/** Discord の認可画面の URL だけを開く（Panel が返した URL でも、別のサイトなら開かない） */
export function isDiscordAuthorizeUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'discord.com' || url.hostname === 'discordapp.com') &&
      /^\/(api\/)?oauth2\/authorize\/?$/.test(url.pathname)
    )
  } catch {
    return false
  }
}

async function proveAccount(deps: LinkDeps, account: LinkAccount) {
  const start = await deps.panel.linkStart()
  const response = await deps.fetch(JOIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accessToken: account.accessToken,
      selectedProfile: account.uuid.replace(/-/g, ''),
      serverId: start.serverId,
    }),
    signal: AbortSignal.timeout(15000),
  })
  if (response.status !== 204 && !response.ok) {
    throw new Error('Minecraft アカウントの確認に失敗しました。ログインし直してください')
  }
  const verified = await deps.panel.linkVerify(start.linkId, account.name)
  return { linkId: start.linkId, verified }
}

/** 連携して Discord の表示名を返す */
export async function linkDiscord(deps: LinkDeps, account: LinkAccount): Promise<{ name: string }> {
  const { linkId, verified } = await proveAccount(deps, account)
  if (!isDiscordAuthorizeUrl(verified.authorizeUrl)) {
    throw new Error('Panel から想定外の URL が返されました')
  }
  await deps.openExternal(verified.authorizeUrl)
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const deadline = Date.now() + (deps.timeoutMs ?? 5 * 60 * 1000)
  while (Date.now() < deadline) {
    await sleep(2000)
    const status = await deps.panel.linkStatus(linkId)
    if (status.state === 'linked' && status.discord) return { name: status.discord.name }
    if (status.state === 'expired') break
  }
  throw new Error('時間内に Discord での許可が終わりませんでした。もう一度試してください')
}

export async function unlinkDiscord(deps: LinkDeps, account: LinkAccount): Promise<void> {
  const { linkId } = await proveAccount(deps, account)
  await deps.panel.linkUnlink(linkId)
}
