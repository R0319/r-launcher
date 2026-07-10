import type { LoaderType } from '../shared/types'

const NEOFORGE_META = 'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml'

// Minecraft バージョン → NeoForge 接頭辞（例: 1.21.1 → 21.1.）
function neoforgePrefix(mcVersion: string): string {
  const parts = mcVersion.split('.')
  return `${parts[1] ?? '0'}.${parts[2] ?? '0'}.`
}

async function resolveNeoforge(mcVersion: string): Promise<string> {
  const res = await fetch(NEOFORGE_META)
  if (!res.ok) throw new Error(`NeoForgeバージョン一覧取得に失敗 (HTTP ${res.status})`)
  const xml = await res.text()
  const prefix = neoforgePrefix(mcVersion)
  const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)]
    .map((m) => m[1])
    .filter((v) => v.startsWith(prefix))
  if (versions.length === 0) throw new Error(`MC ${mcVersion} 対応のNeoForge版が見つかりません`)
  versions.sort((a, b) => Number(a.slice(prefix.length)) - Number(b.slice(prefix.length)))
  return versions[versions.length - 1]
}

async function resolveFabricLike(
  api: string,
  mcVersion: string,
  loaderName: string,
): Promise<string> {
  const res = await fetch(`${api}/versions/loader/${encodeURIComponent(mcVersion)}`)
  if (!res.ok) throw new Error(`${loaderName}バージョン取得に失敗 (HTTP ${res.status})`)
  const data = (await res.json()) as { loader: { version: string; stable?: boolean } }[]
  const stable = data.find((d) => d.loader.stable) ?? data[0]
  if (!stable) throw new Error(`MC ${mcVersion} 対応の${loaderName}版が見つかりません`)
  return stable.loader.version
}

async function resolveForge(mcVersion: string): Promise<string> {
  const res = await fetch(
    'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json',
  )
  if (!res.ok) throw new Error(`Forgeバージョン取得に失敗 (HTTP ${res.status})`)
  const data = (await res.json()) as { promos: Record<string, string> }
  const v = data.promos[`${mcVersion}-latest`] ?? data.promos[`${mcVersion}-recommended`]
  if (!v) throw new Error(`MC ${mcVersion} 対応のForge版が見つかりません`)
  return `${mcVersion}-${v}`
}

// ローダー種別・MCバージョンに応じて loaderVersion を解決する。
// configured が具体値ならそのまま、'latest'/空なら各配信元から最新を解決する。
export async function resolveLoaderVersion(
  loader: LoaderType,
  mcVersion: string,
  configured: string,
): Promise<string> {
  if (loader === 'vanilla') return ''
  if (configured && configured !== 'latest') return configured

  switch (loader) {
    case 'neoforge':
      return resolveNeoforge(mcVersion)
    case 'fabric':
      return resolveFabricLike('https://meta.fabricmc.net/v2', mcVersion, 'Fabric')
    case 'quilt':
      return resolveFabricLike('https://meta.quiltmc.org/v3', mcVersion, 'Quilt')
    case 'forge':
      return resolveForge(mcVersion)
    default:
      throw new Error(`未知のローダー: ${loader}`)
  }
}
