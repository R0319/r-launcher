import type { LoaderType, ModSide } from './types.js'

const API = 'https://api.modrinth.com/v2'
// Modrinth はマナーとして User-Agent を要求する。
const UA = 'r-launcher/1.0 (participatory MC server launcher)'

async function mfetch(url: string): Promise<Response> {
  return fetch(url, { headers: { 'User-Agent': UA } })
}

export interface SearchHit {
  projectId: string
  slug: string
  title: string
  description: string
  iconUrl: string | null
  downloads: number
  categories: string[]
}

// MOD 検索（対象ローダー・MCバージョンで絞り込み）。
export async function searchMods(
  query: string,
  loader: LoaderType,
  mcVersion: string,
): Promise<SearchHit[]> {
  const facets: string[][] = [['project_type:mod']]
  if (loader !== 'vanilla') facets.push([`categories:${loader}`])
  if (mcVersion) facets.push([`versions:${mcVersion}`])
  const url =
    `${API}/search?limit=20&query=${encodeURIComponent(query)}` +
    `&facets=${encodeURIComponent(JSON.stringify(facets))}`
  const res = await mfetch(url)
  if (!res.ok) throw new Error(`Modrinth検索に失敗 (HTTP ${res.status})`)
  const data = (await res.json()) as { hits: any[] }
  return data.hits.map((h) => ({
    projectId: h.project_id,
    slug: h.slug,
    title: h.title,
    description: h.description,
    iconUrl: h.icon_url ?? null,
    downloads: h.downloads,
    categories: h.categories ?? [],
  }))
}

interface ModrinthVersion {
  id: string
  files: { url: string; filename: string; primary: boolean; hashes: { sha256?: string } }[]
  dependencies: { project_id: string | null; dependency_type: string }[]
}

async function resolveVersion(
  projectId: string,
  loader: LoaderType,
  mcVersion: string,
): Promise<ModrinthVersion | null> {
  const loaders = loader === 'vanilla' ? [] : [loader]
  const url =
    `${API}/project/${projectId}/version` +
    `?loaders=${encodeURIComponent(JSON.stringify(loaders))}` +
    `&game_versions=${encodeURIComponent(JSON.stringify([mcVersion]))}`
  const res = await mfetch(url)
  if (!res.ok) return null
  const versions = (await res.json()) as ModrinthVersion[]
  return versions[0] ?? null // Modrinth は新しい順で返す
}

// modrinth.json / manifest に記録する MOD エントリ。
// 料金最適化のため、ファイルは EC2 に保存せず Modrinth CDN の URL をそのまま配布する。
export interface ModrinthModEntry {
  fileName: string
  sha256: string
  cdnUrl: string
  side: ModSide
}

// project を解決し、本体＋必須依存の CDN 配布用エントリ一覧を返す（EC2 にはDLしない）。
export async function resolveInstallEntries(
  projectId: string,
  loader: LoaderType,
  mcVersion: string,
  side: ModSide,
  entries: ModrinthModEntry[] = [],
  visited: Set<string> = new Set(),
): Promise<ModrinthModEntry[]> {
  if (visited.has(projectId)) return entries
  visited.add(projectId)

  const version = await resolveVersion(projectId, loader, mcVersion)
  if (!version) return entries

  const file = version.files.find((f) => f.primary) ?? version.files[0]
  if (file && file.hashes.sha256) {
    if (!entries.some((e) => e.fileName === file.filename)) {
      entries.push({ fileName: file.filename, sha256: file.hashes.sha256, cdnUrl: file.url, side })
    }
  }

  for (const dep of version.dependencies) {
    if (dep.dependency_type === 'required' && dep.project_id) {
      await resolveInstallEntries(dep.project_id, loader, mcVersion, side, entries, visited)
    }
  }
  return entries
}
