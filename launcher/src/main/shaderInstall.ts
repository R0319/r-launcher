import { writeFile, readdir, mkdir, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const API = 'https://api.modrinth.com/v2'
const UA = 'r-launcher/1.0 (participatory MC server launcher)'

function mfetch(url: string): Promise<Response> {
  return fetch(url, { headers: { 'User-Agent': UA } })
}

export interface ShaderHit {
  projectId: string
  slug: string
  title: string
  description: string
  iconUrl: string | null
  downloads: number
}

// Modrinth のシェーダーを検索（MCバージョンで絞り込み。ローダーでは絞らない）。
export async function searchShaders(query: string, mcVersion: string): Promise<ShaderHit[]> {
  const facets: string[][] = [['project_type:shader']]
  if (mcVersion) facets.push([`versions:${mcVersion}`])
  const url =
    `${API}/search?limit=20&query=${encodeURIComponent(query)}` +
    `&facets=${encodeURIComponent(JSON.stringify(facets))}`
  const res = await mfetch(url)
  if (!res.ok) throw new Error(`シェーダー検索に失敗 (HTTP ${res.status})`)
  const data = (await res.json()) as { hits: any[] }
  return data.hits.map((h) => ({
    projectId: h.project_id,
    slug: h.slug,
    title: h.title,
    description: h.description,
    iconUrl: h.icon_url ?? null,
    downloads: h.downloads,
  }))
}

// 指定シェーダーを、そのインスタンスの shaderpacks/ に直接ダウンロードする（EC2 非経由）。
export async function installShader(
  instanceRoot: string,
  projectId: string,
  mcVersion: string,
): Promise<string> {
  const url = `${API}/project/${projectId}/version?game_versions=${encodeURIComponent(
    JSON.stringify([mcVersion]),
  )}`
  const res = await mfetch(url)
  if (!res.ok) throw new Error(`シェーダー版取得に失敗 (HTTP ${res.status})`)
  const versions = (await res.json()) as {
    files: { url: string; filename: string; primary: boolean }[]
  }[]
  const version = versions[0]
  if (!version) throw new Error(`Minecraft ${mcVersion} に対応するシェーダー版が見つかりません`)
  const file = version.files.find((f) => f.primary) ?? version.files[0]
  if (!file) throw new Error('ダウンロード可能なファイルがありません')

  const dir = path.join(instanceRoot, 'shaderpacks')
  if (!existsSync(dir)) await mkdir(dir, { recursive: true })
  const fileRes = await mfetch(file.url)
  if (!fileRes.ok) throw new Error(`シェーダーDL失敗 (HTTP ${fileRes.status})`)
  await writeFile(path.join(dir, file.filename), Buffer.from(await fileRes.arrayBuffer()))
  return file.filename
}

// インストール済みシェーダー一覧（shaderpacks/*.zip）。
export async function listInstalledShaders(instanceRoot: string): Promise<string[]> {
  const dir = path.join(instanceRoot, 'shaderpacks')
  try {
    return (await readdir(dir)).filter((f) => f.endsWith('.zip'))
  } catch {
    return []
  }
}

// シェーダー削除。
export async function deleteShader(instanceRoot: string, fileName: string): Promise<void> {
  if (fileName !== path.basename(fileName)) throw new Error('不正なファイル名')
  await unlink(path.join(instanceRoot, 'shaderpacks', fileName))
}
