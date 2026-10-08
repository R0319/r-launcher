// ランチャーの操作の本体。Electron に依存する部分（ダイアログ・クリップボード・ログイン画面など）は
// Platform として外から渡し、テストでは偽物に差し替える。
import { existsSync } from 'node:fs'
import { mkdir, rename } from 'node:fs/promises'
import path from 'node:path'
import type { Account } from 'eml-lib'
import type { LauncherManifest, PackSummary } from '../shared/contract'
import type {
  AppState,
  ServerDetail,
  ServerView,
  PingView,
  IntegrityView,
  SettingsPatch,
} from '../shared/ipc'
import { parseSettings } from '../shared/settings'
import type { Addons } from './addons'
import { backgroundUrl } from './background'
import { checkIntegrity, type IntegrityReport } from './integrity'
import { resolveInstanceRoot } from './instancePath'
import type { LogBuffer } from './logs'
import { readLocalJars, readManaged } from './modSync'
import { normalizePanelUrl, PanelClient } from './panel'
import type { PingResult } from './serverPing'
import type { Store } from './store'
import type { Http } from './http'

export interface Platform {
  version: string
  totalMemoryMb: number
  homeDir: string
  chooseDirectory(): Promise<string | null>
  chooseFile(kind: 'image' | 'java'): Promise<string | null>
  copyText(text: string): void
  saveText(defaultName: string, text: string): Promise<boolean>
  openPath(target: string): Promise<void>
  openExternal(url: string): Promise<void>
  trash(target: string): Promise<void>
  login(): Promise<Account>
  refresh(account: Account): Promise<Account>
  ping(host: string, port: number): Promise<PingResult>
}

export interface ServiceDeps {
  store: Store
  http: Http
  addons: Addons
  logs: LogBuffer
  platform: Platform
  backgroundsDir: string
}

const MANIFEST_TTL_MS = 30_000

export class LauncherService {
  private packs: PackSummary[] = []
  private manifests = new Map<string, { at: number; manifest: LauncherManifest }>()

  constructor(readonly deps: ServiceDeps) {}

  get settings() {
    return this.deps.store.load().settings
  }

  panel(): PanelClient {
    const url = normalizePanelUrl(this.settings.panelUrl)
    if (!url) throw new Error('Panel の URL が正しくありません。設定を確かめてください')
    return new PanelClient(this.deps.http, url)
  }

  state(): AppState {
    const data = this.deps.store.load()
    return {
      version: this.deps.platform.version,
      setupCompleted: data.setupCompleted && !!data.settings.instanceBaseDir,
      settings: data.settings,
      account: data.account ? { name: data.account.name, uuid: data.account.uuid } : null,
      discord: data.discord,
      totalMemoryMb: this.deps.platform.totalMemoryMb,
      backgroundUrl: backgroundUrl(data.settings.appearance.background),
    }
  }

  saveSettings(patch: SettingsPatch): AppState {
    if (patch.panelUrl !== undefined && !normalizePanelUrl(patch.panelUrl)) {
      throw new Error('Panel の URL は https:// で始まる形で入力してください')
    }
    this.deps.store.update((data) => ({
      ...data,
      settings: parseSettings({
        ...data.settings,
        ...patch,
        appearance: { ...data.settings.appearance, ...patch.appearance },
        java: { ...data.settings.java, ...patch.java },
      }),
    }))
    if (patch.panelUrl !== undefined) this.manifests.clear()
    return this.state()
  }

  async chooseInstanceDir(): Promise<string | null> {
    const dir = await this.deps.platform.chooseDirectory()
    if (!dir) return null
    this.deps.store.update((data) => ({
      ...data,
      settings: { ...data.settings, instanceBaseDir: dir },
    }))
    return dir
  }

  completeSetup(): AppState {
    if (!this.settings.instanceBaseDir) throw new Error('ゲームデータの保存先を選んでください')
    this.deps.store.update((data) => ({ ...data, setupCompleted: true }))
    return this.state()
  }

  async login(): Promise<AppState> {
    const account = await this.deps.platform.login()
    this.deps.store.update((data) => ({ ...data, account }))
    this.deps.logs.write('launcher', `Microsoft アカウントでログインしました: ${account.name}`)
    return this.state()
  }

  logout(): AppState {
    this.deps.store.update((data) => ({ ...data, account: null }))
    return this.state()
  }

  /** トークンを必要なら更新してから返す */
  async freshAccount(): Promise<Account> {
    const account = this.deps.store.load().account
    if (!account) throw new Error('Microsoft アカウントでログインしてください')
    try {
      const fresh = await this.deps.platform.refresh(account)
      if (fresh !== account) this.deps.store.update((data) => ({ ...data, account: fresh }))
      return fresh
    } catch {
      throw new Error('ログインの有効期限が切れました。もう一度ログインしてください')
    }
  }

  gameDir(serverId: string): string {
    const base = this.settings.instanceBaseDir
    if (!base) throw new Error('ゲームデータの保存先が決まっていません')
    return resolveInstanceRoot(base, serverId)
  }

  async listServers(): Promise<ServerView[]> {
    const panel = this.panel()
    try {
      this.packs = await panel.listPacks()
    } catch (error) {
      throw new Error(panelProblem(error, this.settings.panelUrl))
    }
    const base = this.settings.instanceBaseDir
    return this.packs.map((pack) => ({
      ...pack,
      installed: !!base && existsSync(path.join(resolveInstanceRoot(base, pack.id), 'mods')),
    }))
  }

  private async pack(serverId: string): Promise<PackSummary> {
    const found = this.packs.find((p) => p.id === serverId)
    if (found) return found
    await this.listServers()
    const again = this.packs.find((p) => p.id === serverId)
    if (!again) throw new Error('このサーバーは公開されていません')
    return again
  }

  async ping(serverId: string): Promise<PingView | null> {
    const pack = await this.pack(serverId)
    try {
      const result = await this.deps.platform.ping(pack.host, pack.port)
      return {
        online: result.online,
        max: result.max,
        motd: result.motd.slice(0, 200),
        version: result.version.slice(0, 60),
        latencyMs: Math.round(result.latencyMs),
      }
    } catch {
      return null
    }
  }

  async manifest(serverId: string, fresh = false): Promise<LauncherManifest> {
    const cached = this.manifests.get(serverId)
    if (!fresh && cached && Date.now() - cached.at < MANIFEST_TTL_MS) return cached.manifest
    const manifest = await this.panel().manifest(serverId)
    this.manifests.set(serverId, { at: Date.now(), manifest })
    return manifest
  }

  disabledOptional(serverId: string): Set<string> {
    return new Set(this.settings.disabledOptionalMods[serverId] ?? [])
  }

  async integrity(serverId: string, manifest: LauncherManifest): Promise<IntegrityReport | null> {
    const modsDir = path.join(this.gameDir(serverId), 'mods')
    if (!existsSync(modsDir)) return null
    return checkIntegrity({
      manifest,
      disabledOptional: this.disabledOptional(serverId),
      local: await readLocalJars(modsDir),
    })
  }

  async detail(serverId: string): Promise<ServerDetail> {
    const manifest = await this.manifest(serverId)
    const disabled = this.disabledOptional(serverId)
    const base = this.settings.instanceBaseDir
    const gameDir = base ? this.gameDir(serverId) : null
    const shaderConfig = shaderConfigOf(manifest)
    const report = gameDir ? await this.integrity(serverId, manifest) : null
    return {
      id: manifest.id,
      name: manifest.name,
      mcVersion: manifest.mcVersion,
      loader: manifest.loader,
      loaderVersion: manifest.loaderVersion,
      revision: manifest.revision,
      policy: manifest.integrity,
      mods: manifest.mods.map((mod) => ({
        projectId: mod.projectId,
        title: mod.title,
        versionNumber: mod.versionNumber,
        fileName: mod.fileName,
        side: mod.side,
        enabled: mod.side === 'required' || !disabled.has(mod.projectId),
      })),
      serverOnly: manifest.serverOnly.map((m) => m.title),
      integrity: report ? integrityView(report) : null,
      resourcepacks: gameDir
        ? await this.deps.addons.list('resourcepack', gameDir, shaderConfig ?? 'iris.properties')
        : [],
      shaders: gameDir
        ? await this.deps.addons.list('shader', gameDir, shaderConfig ?? 'iris.properties')
        : [],
      shaderLoader: shaderConfig !== null,
    }
  }

  async setOptionalMod(serverId: string, projectId: string, enabled: boolean) {
    const manifest = await this.manifest(serverId)
    const mod = manifest.mods.find((m) => m.projectId === projectId)
    if (!mod || mod.side !== 'optional') throw new Error('この Mod は外せません')
    this.deps.store.update((data) => {
      const current = new Set(data.settings.disabledOptionalMods[serverId] ?? [])
      if (enabled) current.delete(projectId)
      else current.add(projectId)
      return {
        ...data,
        settings: {
          ...data.settings,
          disabledOptionalMods: { ...data.settings.disabledOptionalMods, [serverId]: [...current] },
        },
      }
    })
    return this.detail(serverId)
  }

  /** 許可されない余分な jar を mods-disabled/<日時>/ に移す（利用者が押したときだけ。削除はしない） */
  async retireExtraMods(serverId: string) {
    const manifest = await this.manifest(serverId, true)
    const report = await this.integrity(serverId, manifest)
    const extras = report?.extras.filter((e) => !e.allowed).map((e) => e.fileName) ?? []
    const managed = new Set(await readManaged(path.join(this.gameDir(serverId), 'mods')))
    const targets = extras.filter((name) => !managed.has(name))
    if (targets.length) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const dir = path.join(this.gameDir(serverId), 'mods-disabled', stamp)
      await mkdir(dir, { recursive: true })
      for (const name of targets) {
        await rename(
          path.join(this.gameDir(serverId), 'mods', path.basename(name)),
          path.join(dir, path.basename(name)),
        )
      }
      this.deps.logs.write(
        'launcher',
        `余分な Mod を ${targets.length} 個、mods-disabled に移しました`,
      )
    }
    return this.detail(serverId)
  }
}

/** Panel につながらないときの、利用者が次に何をすればよいかが分かる文 */
export function panelProblem(error: unknown, panelUrl: string): string {
  let host = panelUrl
  try {
    host = new URL(panelUrl).host
  } catch {
    // URL として読めなければそのまま出す
  }
  const status = (error as { status?: number }).status
  if (status === 404)
    return `Panel（${host}）にサーバーの一覧がありません。設定の「Panel の URL」を確かめてください`
  if (status && status >= 500)
    return `Panel（${host}）が応答できない状態です。しばらくしてから再読み込みしてください`
  if (error instanceof Error && error.message.includes('応答の形')) {
    return `Panel（${host}）の応答を読めません。ランチャーを最新版に更新してください`
  }
  return `Panel（${host}）につながりません。インターネット接続と、設定の「Panel の URL」を確かめてください`
}

/** Iris / Oculus の設定ファイル名。どちらも無ければシェーダーは使えない */
export function shaderConfigOf(manifest: LauncherManifest): string | null {
  const slugs = manifest.mods.map((m) => m.slug.toLowerCase())
  if (slugs.includes('oculus')) return 'oculus.properties'
  if (slugs.includes('iris')) return 'iris.properties'
  return null
}

export function integrityView(report: IntegrityReport): IntegrityView {
  return {
    verdict: report.verdict,
    missing: report.missing.map((m) => m.title),
    mismatched: report.mismatched.map((m) => `${m.mod.title}（${m.fileName}）`),
    extras: report.extras,
  }
}
