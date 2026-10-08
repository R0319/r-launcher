// リソースパックとシェーダーパック（Modrinth から検索して入れる）。
// 入れたファイルは中身のハッシュを確かめてから置き、options.txt / iris.properties で有効にする。
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { AddonHit, AddonType, InstalledAddon } from '../shared/ipc'
import { sha1, sha512 } from './hash'
import type { Http } from './http'
import { DOWNLOAD_HOSTS } from './http'
import { readIrisShader, readResourcePacks, setIrisShader, setResourcePacks } from './gameOptions'

const API = 'https://api.modrinth.com/v2'
const MAX_ADDON_BYTES = 256 * 1024 * 1024
export const ADDON_FILE = /^[^/\\:*?"<>|\0]+\.zip$/i

const SearchSchema = z.object({
  hits: z
    .array(
      z.object({
        project_id: z.string(),
        slug: z.string(),
        title: z.string(),
        description: z.string().default(''),
        author: z.string().default(''),
        downloads: z.number().default(0),
        icon_url: z.string().nullable().optional(),
      }),
    )
    .max(100),
})

const VersionSchema = z.object({
  id: z.string(),
  game_versions: z.array(z.string()),
  files: z.array(
    z.object({
      url: z.string().url(),
      filename: z.string(),
      primary: z.boolean().default(false),
      size: z.number().int().nonnegative(),
      hashes: z.object({ sha1: z.string().optional(), sha512: z.string().optional() }),
    }),
  ),
})

export function folderOf(type: AddonType): 'resourcepacks' | 'shaderpacks' {
  return type === 'resourcepack' ? 'resourcepacks' : 'shaderpacks'
}

/** Modrinth のアイコンは cdn.modrinth.com のものだけ画面に出す（CSP と合わせる） */
function safeIcon(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.hostname === 'cdn.modrinth.com' ? url : null
  } catch {
    return null
  }
}

export class Addons {
  constructor(
    private readonly http: Http,
    private readonly trash: (file: string) => Promise<void>,
  ) {}

  async search(type: AddonType, query: string, mcVersion: string, offset = 0): Promise<AddonHit[]> {
    const facets: string[][] = [[`project_type:${type}`], [`versions:${mcVersion}`]]
    const url =
      `${API}/search?limit=20&offset=${offset}&index=relevance` +
      `&query=${encodeURIComponent(query.trim())}&facets=${encodeURIComponent(JSON.stringify(facets))}`
    const data = await this.http.getJson(url, SearchSchema)
    return data.hits.map((hit) => ({
      projectId: hit.project_id,
      slug: hit.slug,
      title: hit.title,
      description: hit.description.slice(0, 300),
      author: hit.author,
      downloads: hit.downloads,
      iconUrl: safeIcon(hit.icon_url),
    }))
  }

  /** その Minecraft の版に合う最新版を選び、ハッシュを確かめて置く。有効にした名前を返す */
  async install(type: AddonType, projectId: string, mcVersion: string, gameDir: string) {
    const loaders = type === 'shader' ? ['iris', 'optifine'] : ['minecraft']
    const base = `${API}/project/${encodeURIComponent(projectId)}/version`
    const exact = await this.http.getJson(
      `${base}?game_versions=${encodeURIComponent(JSON.stringify([mcVersion]))}&loaders=${encodeURIComponent(JSON.stringify(loaders))}`,
      z.array(VersionSchema).max(500),
    )
    const version = exact[0]
    if (!version) throw new Error(`Minecraft ${mcVersion} に対応する版がありません`)
    const file = version.files.find((f) => f.primary) ?? version.files[0]
    if (!file || !ADDON_FILE.test(file.filename))
      throw new Error('入れられる形式（.zip）のファイルがありません')
    if (!file.hashes.sha512 && !file.hashes.sha1)
      throw new Error('ファイルのハッシュが無いので入れられません')
    const data = await this.http.getBytes(file.url, {
      maxBytes: Math.min(MAX_ADDON_BYTES, file.size + 1),
      allowedHosts: DOWNLOAD_HOSTS,
    })
    if (file.hashes.sha512 && sha512(data) !== file.hashes.sha512)
      throw new Error('ダウンロードしたファイルが壊れています')
    if (!file.hashes.sha512 && file.hashes.sha1 && sha1(data) !== file.hashes.sha1)
      throw new Error('ダウンロードしたファイルが壊れています')
    const dir = path.join(gameDir, folderOf(type))
    await mkdir(dir, { recursive: true })
    const target = inside(dir, file.filename)
    await writeFile(`${target}.part`, data)
    await rename(`${target}.part`, target)
    return file.filename
  }

  async list(type: AddonType, gameDir: string, shaderConfig: string): Promise<InstalledAddon[]> {
    const dir = path.join(gameDir, folderOf(type))
    if (!existsSync(dir)) return []
    const enabled = await this.enabledSet(type, gameDir, shaderConfig)
    const names = (await readdir(dir)).filter((name) => ADDON_FILE.test(name)).sort()
    return Promise.all(
      names.map(async (fileName) => ({
        fileName,
        enabled: enabled.has(fileName),
        sizeBytes: (await stat(path.join(dir, fileName))).size,
      })),
    )
  }

  async setEnabled(
    type: AddonType,
    gameDir: string,
    shaderConfig: string,
    fileName: string,
    on: boolean,
  ) {
    if (!ADDON_FILE.test(fileName)) throw new Error('ファイル名が正しくありません')
    if (type === 'resourcepack') {
      const file = path.join(gameDir, 'options.txt')
      const text = existsSync(file) ? await readFile(file, 'utf-8') : ''
      const current = readResourcePacks(text).filter((p) => p.startsWith('file/'))
      const name = `file/${fileName}`
      const next = on
        ? [...current.filter((p) => p !== name), name]
        : current.filter((p) => p !== name)
      await writeAtomic(file, setResourcePacks(text, next))
      return
    }
    const file = path.join(gameDir, 'config', shaderConfig)
    const text = existsSync(file) ? await readFile(file, 'utf-8') : ''
    const current = readIrisShader(text)
    if (!on && current.pack !== fileName) return
    await mkdir(path.dirname(file), { recursive: true })
    await writeAtomic(file, setIrisShader(text, on ? fileName : null))
  }

  /** 無効にしてから OS のごみ箱へ（完全には消さない） */
  async remove(type: AddonType, gameDir: string, shaderConfig: string, fileName: string) {
    await this.setEnabled(type, gameDir, shaderConfig, fileName, false)
    const file = inside(path.join(gameDir, folderOf(type)), fileName)
    if (existsSync(file)) await this.trash(file)
  }

  private async enabledSet(type: AddonType, gameDir: string, shaderConfig: string) {
    if (type === 'resourcepack') {
      const file = path.join(gameDir, 'options.txt')
      const text = existsSync(file) ? await readFile(file, 'utf-8') : ''
      return new Set(
        readResourcePacks(text).flatMap((p) => (p.startsWith('file/') ? [p.slice(5)] : [])),
      )
    }
    const file = path.join(gameDir, 'config', shaderConfig)
    const text = existsSync(file) ? await readFile(file, 'utf-8') : ''
    const current = readIrisShader(text)
    return new Set(current.enabled && current.pack ? [current.pack] : [])
  }
}

/** フォルダの外を指す名前を拒否する */
export function inside(dir: string, fileName: string): string {
  if (!ADDON_FILE.test(fileName) && !fileName.endsWith('.jar'))
    throw new Error('ファイル名が正しくありません')
  const target = path.resolve(dir, fileName)
  if (path.dirname(target) !== path.resolve(dir)) throw new Error('ファイル名が正しくありません')
  return target
}

async function writeAtomic(file: string, text: string) {
  await writeFile(`${file}.tmp`, text, 'utf-8')
  await rename(`${file}.tmp`, file)
}
