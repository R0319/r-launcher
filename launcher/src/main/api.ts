import { config } from './config'
import type { LoaderType, Manifest, ManifestEntry, ModSide, Modpack, PlayerStatus } from '../shared/types'

async function postJson<T>(pathname: string, body: unknown): Promise<T> {
  const res = await fetch(`${config.apiBaseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let detail = ''
    try {
      detail = JSON.stringify(await res.json())
    } catch {
      /* noop */
    }
    throw new Error(`POST ${pathname} failed: ${res.status} ${detail}`)
  }
  return (await res.json()) as T
}

async function get<T>(pathname: string): Promise<T> {
  const res = await fetch(`${config.apiBaseUrl}${pathname}`)
  if (!res.ok) throw new Error(`GET ${pathname} failed: ${res.status}`)
  return (await res.json()) as T
}

// --- modpack ---
export async function fetchModpacks(): Promise<Modpack[]> {
  const data = await get<{ modpacks: Modpack[] }>('/modpacks')
  return data.modpacks
}

export async function fetchManifest(modpackId: string): Promise<Manifest> {
  return get<Manifest>(`/modpacks/${encodeURIComponent(modpackId)}/manifest`)
}

export async function fetchPlayerStatus(uuid: string): Promise<PlayerStatus> {
  const res = await fetch(`${config.apiBaseUrl}/player/${uuid}`)
  if (res.status === 404) return { registered: false }
  if (!res.ok) throw new Error(`GET /player/${uuid} failed: ${res.status}`)
  return (await res.json()) as PlayerStatus
}

export async function submitDiscordCallback(
  code: string,
  uuid: string,
  mcid: string,
  msAccessToken: string,
): Promise<{ discordId: string; discordName: string }> {
  const res = await fetch(`${config.apiBaseUrl}/auth/discord/callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, uuid, mcid, msAccessToken }),
  })
  if (!res.ok) throw new Error(`Discord連携に失敗しました: ${res.status}`)
  return (await res.json()) as { discordId: string; discordName: string }
}

export async function downloadFile(url: string): Promise<Buffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`ダウンロード失敗: ${url} (${res.status})`)
  return Buffer.from(await res.arrayBuffer())
}

// --- 管理者API ---
export async function adminCheck(
  msAccessToken: string,
): Promise<{ isAdmin: boolean; name?: string; isMaster?: boolean }> {
  const res = await fetch(`${config.apiBaseUrl}/admin/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msAccessToken }),
  })
  if (res.status === 403) return { isAdmin: false, isMaster: false }
  if (!res.ok) throw new Error(`admin/check failed: ${res.status}`)
  return (await res.json()) as { isAdmin: boolean; name?: string; isMaster?: boolean }
}

// --- 管理者アカウント管理（マスターのみ） ---
export interface AdminRecord {
  uuid: string
  mcid: string
  addedBy: string
  addedAt: string
}

export async function adminListAdmins(
  msAccessToken: string,
): Promise<{ masters: string[]; admins: AdminRecord[] }> {
  return postJson<{ masters: string[]; admins: AdminRecord[] }>('/admin/admins', { msAccessToken })
}

export async function adminAddAdmin(
  msAccessToken: string,
  mcid: string,
): Promise<{ added: { uuid: string; mcid: string }; admins: AdminRecord[] }> {
  return postJson<{ added: { uuid: string; mcid: string }; admins: AdminRecord[] }>(
    '/admin/admins/add',
    { msAccessToken, mcid },
  )
}

export async function adminRemoveAdmin(
  msAccessToken: string,
  uuid: string,
): Promise<{ admins: AdminRecord[] }> {
  return postJson<{ admins: AdminRecord[] }>('/admin/admins/remove', { msAccessToken, uuid })
}

// modpack CRUD（管理者）
export async function adminListModpacks(msAccessToken: string): Promise<Modpack[]> {
  const data = await postJson<{ modpacks: Modpack[] }>('/admin/modpacks', { msAccessToken })
  return data.modpacks
}

export async function adminCreateModpack(
  msAccessToken: string,
  mp: { id: string; name: string; loader: LoaderType; mcVersion: string; loaderVersion: string },
): Promise<Modpack[]> {
  const data = await postJson<{ modpacks: Modpack[] }>('/admin/modpacks/create', {
    msAccessToken,
    ...mp,
  })
  return data.modpacks
}

export async function adminUpdateModpack(
  msAccessToken: string,
  modpackId: string,
  patch: Partial<{ name: string; loader: LoaderType; mcVersion: string; loaderVersion: string }>,
): Promise<Modpack> {
  const data = await postJson<{ modpack: Modpack }>('/admin/modpacks/update', {
    msAccessToken,
    modpackId,
    ...patch,
  })
  return data.modpack
}

export async function adminDeleteModpack(msAccessToken: string, modpackId: string): Promise<Modpack[]> {
  const data = await postJson<{ modpacks: Modpack[] }>('/admin/modpacks/delete', {
    msAccessToken,
    modpackId,
  })
  return data.modpacks
}

// MOD 管理（指定 modpack）
export async function adminListMods(msAccessToken: string, modpackId: string): Promise<ManifestEntry[]> {
  const data = await postJson<{ mods: ManifestEntry[] }>('/admin/mods', { msAccessToken, modpackId })
  return data.mods
}

export async function adminUpload(
  msAccessToken: string,
  modpackId: string,
  fileName: string,
  side: ModSide,
  dataBase64: string,
): Promise<ManifestEntry[]> {
  const data = await postJson<{ mods: ManifestEntry[] }>('/admin/upload', {
    msAccessToken,
    modpackId,
    fileName,
    side,
    dataBase64,
  })
  return data.mods
}

export async function adminDelete(
  msAccessToken: string,
  modpackId: string,
  fileName: string,
  side: ModSide,
): Promise<ManifestEntry[]> {
  const data = await postJson<{ mods: ManifestEntry[] }>('/admin/delete', {
    msAccessToken,
    modpackId,
    fileName,
    side,
  })
  return data.mods
}

export async function adminRegenerate(msAccessToken: string, modpackId: string): Promise<number> {
  const data = await postJson<{ count: number }>('/admin/regenerate', { msAccessToken, modpackId })
  return data.count
}

// --- Modrinth 連携 ---
export interface ModrinthHit {
  projectId: string
  slug: string
  title: string
  description: string
  iconUrl: string | null
  downloads: number
  categories: string[]
}

export async function modrinthSearch(
  msAccessToken: string,
  modpackId: string,
  query: string,
): Promise<ModrinthHit[]> {
  const data = await postJson<{ hits: ModrinthHit[] }>('/admin/modrinth/search', {
    msAccessToken,
    modpackId,
    query,
  })
  return data.hits
}

export async function modrinthInstall(
  msAccessToken: string,
  modpackId: string,
  projectId: string,
  side: ModSide,
): Promise<{ installed: string[]; mods: ManifestEntry[] }> {
  return postJson<{ installed: string[]; mods: ManifestEntry[] }>('/admin/modrinth/install', {
    msAccessToken,
    modpackId,
    projectId,
    side,
  })
}
