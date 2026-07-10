import { config } from './config.js'
import { listAdmins } from './adminStore.js'

interface MinecraftProfile {
  id: string
  name: string
}

export function normalizeUuid(uuid: string): string {
  return uuid.replace(/-/g, '').toLowerCase()
}

export interface AdminIdentity {
  uuid: string
  name: string
  isMaster: boolean
}

// トークン→Minecraftプロフィールの解決結果を短時間キャッシュする。
// 管理操作のたびに profile API を叩くとレート制限で 403 になりうるため。
// ※ 管理者判定そのものはキャッシュしない（admins.json の追加/削除を即反映するため）。
const CACHE_TTL_MS = 5 * 60 * 1000
const profileCache = new Map<string, { profile: MinecraftProfile | null; expires: number }>()

async function resolveProfile(msAccessToken: string): Promise<MinecraftProfile | null> {
  const cached = profileCache.get(msAccessToken)
  if (cached && cached.expires > Date.now()) return cached.profile
  try {
    const res = await fetch('https://api.minecraftservices.com/minecraft/profile', {
      headers: { Authorization: `Bearer ${msAccessToken}` },
    })
    if (!res.ok) return null
    const profile = (await res.json()) as MinecraftProfile
    profileCache.set(msAccessToken, { profile, expires: Date.now() + CACHE_TTL_MS })
    return profile
  } catch {
    return null
  }
}

// MS/Minecraft アクセストークンから本人の {uuid(正規化), name} を得る。
// トークンが不正なら null。/auth などで「送られてきた uuid が本当に本人か」の検証に使う。
export async function resolveMcIdentity(
  msAccessToken: string,
): Promise<{ uuid: string; name: string } | null> {
  if (!msAccessToken) return null
  const profile = await resolveProfile(msAccessToken)
  return profile ? { uuid: normalizeUuid(profile.id), name: profile.name } : null
}

// アクセストークンの本人が管理者（マスター含む）かを判定。管理者なら AdminIdentity。
export async function verifyAdmin(msAccessToken: string): Promise<AdminIdentity | null> {
  if (!msAccessToken) return null
  const profile = await resolveProfile(msAccessToken)
  if (!profile) return null

  const uuid = normalizeUuid(profile.id)
  const masters = config.masterUuids.map(normalizeUuid)
  const isMaster = masters.includes(uuid)
  if (isMaster) return { uuid, name: profile.name, isMaster: true }

  const envAdmins = config.adminUuids.map(normalizeUuid)
  const dynamicAdmins = (await listAdmins()).map((a) => a.uuid)
  if (envAdmins.includes(uuid) || dynamicAdmins.includes(uuid)) {
    return { uuid, name: profile.name, isMaster: false }
  }
  return null
}

// マスター権限が必要な操作向け。マスターなら AdminIdentity、そうでなければ null。
export async function verifyMaster(msAccessToken: string): Promise<AdminIdentity | null> {
  const admin = await verifyAdmin(msAccessToken)
  return admin && admin.isMaster ? admin : null
}

// Minecraft ユーザー名から UUID を解決（管理者追加用）。見つからなければ null。
export async function resolveMcid(name: string): Promise<{ uuid: string; name: string } | null> {
  try {
    const res = await fetch(
      `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`,
    )
    if (res.status !== 200) return null // 404/204 = 該当なし
    const data = (await res.json()) as MinecraftProfile
    return { uuid: normalizeUuid(data.id), name: data.name }
  } catch {
    return null
  }
}
