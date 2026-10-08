import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { JarNameSchema, type ManifestMod, type LauncherManifest } from '../shared/contract'
interface LocalJar {
  fileName: string
  sha1: string
}
export interface SyncPlan {
  download: ManifestMod[]
  retire: string[]
  keep: string[]
}
export function planSync(input: {
  manifest: LauncherManifest
  disabledOptional: ReadonlySet<string>
  local: LocalJar[]
  managed: string[]
}): SyncPlan {
  const wanted = input.manifest.mods.filter(
    (mod) => mod.side === 'required' || !input.disabledOptional.has(mod.projectId),
  )
  const keep = input.local
    .filter(
      (jar) =>
        input.managed.includes(jar.fileName) &&
        wanted.some((mod) => mod.sha1 === jar.sha1.toLowerCase()),
    )
    .map((jar) => jar.fileName)
  return {
    keep: [...new Set(keep)],
    retire: [...new Set(input.managed.filter((name) => !keep.includes(name)))],
    download: wanted.filter(
      (mod) => !input.local.some((jar) => jar.sha1.toLowerCase() === mod.sha1),
    ),
  }
}
function jarPath(modsDir: string, fileName: string): string {
  JarNameSchema.parse(fileName)
  if (fileName.includes('..') || /[\r\n]/.test(fileName)) throw new Error('不正なjar名です')
  const root = path.resolve(modsDir),
    target = path.resolve(root, fileName)
  if (path.dirname(target) !== root) throw new Error('modsフォルダ外にはアクセスできません')
  return target
}
const managedName = '.r-launcher-managed.json'
async function exists(file: string): Promise<boolean> {
  try {
    await fs.lstat(file)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}
export async function readManaged(modsDir: string): Promise<string[]> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(path.join(modsDir, managedName), 'utf8'))
    if (!Array.isArray(value)) return []
    return [
      ...new Set(
        value.filter(
          (name): name is string =>
            typeof name === 'string' &&
            JarNameSchema.safeParse(name).success &&
            !name.includes('..') &&
            !/[\r\n]/.test(name),
        ),
      ),
    ]
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT')
      return []
    throw error
  }
}
export async function readLocalJars(modsDir: string): Promise<LocalJar[]> {
  let entries
  try {
    entries = await fs.readdir(modsDir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const result: LocalJar[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !JarNameSchema.safeParse(entry.name).success) continue
    const hash = createHash('sha1')
    const handle = await fs.open(jarPath(modsDir, entry.name), 'r')
    try {
      for await (const chunk of handle.createReadStream({ autoClose: false }))
        hash.update(chunk as Buffer)
    } finally {
      await handle.close()
    }
    result.push({ fileName: entry.name, sha1: hash.digest('hex') })
  }
  return result
}
export async function applySync(input: {
  modsDir: string
  plan: SyncPlan
  download: (url: string, maxBytes: number) => Promise<Buffer>
  now?: Date
  onProgress?: (p: { done: number; total: number; fileName: string }) => void
}): Promise<{ installed: string[]; retired: string[] }> {
  const { modsDir, plan } = input
  for (const name of [...plan.keep, ...plan.retire, ...plan.download.map((mod) => mod.fileName)])
    jarPath(modsDir, name)
  if (
    new Set(plan.download.map((mod) => mod.fileName)).size !== plan.download.length ||
    plan.keep.some(
      (name) => plan.retire.includes(name) || plan.download.some((mod) => mod.fileName === name),
    )
  )
    throw new Error('同期計画が重複しています')
  await fs.mkdir(modsDir, { recursive: true })
  const owned = new Set(await readManaged(modsDir))
  for (const name of plan.retire)
    if ((await exists(jarPath(modsDir, name))) && !owned.has(name))
      throw new Error(`利用者のjarを移動できません: ${name}`)
  for (const mod of plan.download)
    if ((await exists(jarPath(modsDir, mod.fileName))) && !plan.retire.includes(mod.fileName))
      throw new Error(`利用者のjarを上書きできません: ${mod.fileName}`)
  const trash = path.join(
    path.resolve(modsDir, '..'),
    '.r-launcher-trash',
    `${(input.now ?? new Date()).toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`,
  )
  const staging = await fs.mkdtemp(path.join(modsDir, '.r-launcher-stage-'))
  const installed: string[] = [],
    retired: string[] = []
  let done = 0,
    cursor = 0
  try {
    // 全件検証してから移動し、通信途中の失敗では既存構成を変えない。
    const workers = Array.from({ length: Math.min(4, plan.download.length) }, async () => {
      while (cursor < plan.download.length) {
        const mod = plan.download[cursor++]
        if (!mod) break
        const bytes = await input.download(mod.url, mod.size)
        if (
          bytes.length > mod.size ||
          createHash('sha1').update(bytes).digest('hex') !== mod.sha1 ||
          (mod.sha512 && createHash('sha512').update(bytes).digest('hex') !== mod.sha512)
        )
          throw new Error(`ハッシュまたはサイズが一致しません: ${mod.fileName}`)
        await fs.writeFile(path.join(staging, mod.fileName), bytes, { flag: 'wx' })
        input.onProgress?.({ done: ++done, total: plan.download.length, fileName: mod.fileName })
      }
    })
    const results = await Promise.allSettled(workers)
    const failed = results.find((result) => result.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
    for (const name of plan.retire) {
      const source = jarPath(modsDir, name)
      if (!(await exists(source))) continue
      if (!(await fs.lstat(source)).isFile()) throw new Error(`通常のjarではありません: ${name}`)
      await fs.mkdir(trash, { recursive: true })
      await fs.rename(source, path.join(trash, name))
      retired.push(name)
    }
    for (const mod of plan.download) {
      const destination = jarPath(modsDir, mod.fileName)
      if (await exists(destination)) throw new Error(`既存のjarを上書きできません: ${mod.fileName}`)
      await fs.rename(path.join(staging, mod.fileName), destination)
      installed.push(mod.fileName)
    }
    const record = path.join(staging, managedName)
    await fs.writeFile(record, JSON.stringify([...new Set([...plan.keep, ...installed])], null, 2))
    await fs.rename(record, path.join(modsDir, managedName))
    return { installed, retired }
  } catch (error) {
    for (const name of installed.reverse())
      await fs.rename(jarPath(modsDir, name), path.join(staging, name))
    for (const name of retired.reverse())
      await fs.rename(path.join(trash, name), jarPath(modsDir, name))
    throw error
  } finally {
    await fs.rm(staging, { recursive: true, force: true })
  }
}
