// 画面（renderer）と main プロセスの間の約束。preload がこの形で window.rLauncher を公開する。
// 画面からの入力は main 側で必ず zod で検証する（画面は信用しない）。
import { z } from 'zod'
import type { IntegrityPolicy, PackSummary, ServerState } from './contract'
import { ServerIdSchema } from './contract'
import type { Settings } from './settings'
import { AccentSchema, ThemeSchema } from './settings'

export interface AccountView {
  name: string
  uuid: string
}

export interface AppState {
  version: string
  setupCompleted: boolean
  settings: Settings
  account: AccountView | null
  discord: { name: string } | null
  totalMemoryMb: number
  /** 背景画像の URL（rl-bg: スキーム）。無ければ null */
  backgroundUrl: string | null
}

export interface ServerView extends PackSummary {
  /** この PC にゲームデータがあるか */
  installed: boolean
}

export interface PingView {
  online: number
  max: number
  motd: string
  version: string
  latencyMs: number
}

export interface ModView {
  projectId: string
  title: string
  versionNumber: string
  fileName: string
  side: 'required' | 'optional'
  /** optional を利用者が入れる設定にしているか（required は常に true） */
  enabled: boolean
}

export interface IntegrityView {
  verdict: 'ok' | 'warn' | 'block'
  missing: string[]
  mismatched: string[]
  extras: Array<{ fileName: string; allowed: boolean }>
}

export type AddonType = 'resourcepack' | 'shader'

export interface InstalledAddon {
  fileName: string
  enabled: boolean
  sizeBytes: number
}

export interface ServerDetail {
  id: string
  name: string
  mcVersion: string
  loader: string
  loaderVersion: string
  revision: string
  policy: IntegrityPolicy
  mods: ModView[]
  serverOnly: string[]
  integrity: IntegrityView | null
  resourcepacks: InstalledAddon[]
  shaders: InstalledAddon[]
  /** Iris / Oculus が入っているか（シェーダーを使えるか） */
  shaderLoader: boolean
}

export interface AddonHit {
  projectId: string
  slug: string
  title: string
  description: string
  author: string
  downloads: number
  iconUrl: string | null
}

export type PlayPhase =
  | { phase: 'manifest' }
  | { phase: 'mods'; done: number; total: number; fileName?: string }
  | { phase: 'check' }
  | { phase: 'game'; stage: number; downloaded: number; total: number }
  | { phase: 'launching' }
  | { phase: 'running' }
  | { phase: 'closed'; code: number | null }

export type PlayResult =
  | { ok: true }
  | { ok: false; reason: 'integrity'; integrity: IntegrityView }
  | { ok: false; reason: 'error'; message: string }

export type UpdateStatus =
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'none' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }

export interface LogCopyResult {
  lines: number
  masked: Record<string, number>
}

export interface JavaView {
  mode: 'auto' | 'manual'
  path: string | null
  /** manual のとき、指定の java を実行して得た版（確かめられなければ null） */
  detectedVersion: string | null
}

/** 画面から呼べる操作の一覧（preload が実装する） */
export interface RLauncherApi {
  getState(): Promise<AppState>
  saveSettings(patch: SettingsPatch): Promise<AppState>
  chooseInstanceDir(): Promise<string | null>
  completeSetup(): Promise<AppState>

  loginMicrosoft(): Promise<AppState>
  logout(): Promise<AppState>

  listServers(): Promise<ServerView[]>
  pingServer(serverId: string): Promise<PingView | null>
  serverDetail(serverId: string): Promise<ServerDetail>
  setOptionalMod(serverId: string, projectId: string, enabled: boolean): Promise<ServerDetail>
  retireExtraMods(serverId: string): Promise<ServerDetail>
  play(serverId: string): Promise<PlayResult>
  playAnyway(serverId: string): Promise<PlayResult>

  searchAddons(input: AddonSearchInput): Promise<AddonHit[]>
  installAddon(input: AddonInstallInput): Promise<ServerDetail>
  removeAddon(input: AddonFileInput): Promise<ServerDetail>
  setAddonEnabled(input: AddonFileInput & { enabled: boolean }): Promise<ServerDetail>
  openFolder(
    serverId: string,
    folder: 'game' | 'mods' | 'resourcepacks' | 'shaderpacks' | 'logs',
  ): Promise<void>

  checkJava(): Promise<JavaView>
  chooseJava(): Promise<JavaView>
  checkJvmArgs(text: string): Promise<{ ok: true } | { ok: false; error: string }>

  chooseBackground(): Promise<AppState>
  clearBackground(): Promise<AppState>

  linkDiscord(): Promise<AppState>
  unlinkDiscord(): Promise<AppState>

  readLog(): Promise<string>
  copyLog(): Promise<LogCopyResult>
  saveLog(): Promise<LogCopyResult | null>

  installUpdate(): Promise<void>

  onPlayProgress(cb: (p: PlayPhase) => void): () => void
  onLogLine(cb: (line: string) => void): () => void
  onUpdateStatus(cb: (s: UpdateStatus) => void): () => void
}

// ---- main 側で使う入力検証 ----

export const SettingsPatchSchema = z
  .object({
    panelUrl: z.string().max(200),
    discordRichPresence: z.boolean(),
    selectedServerId: ServerIdSchema.nullable(),
    appearance: z
      .object({
        theme: ThemeSchema,
        accent: AccentSchema,
        backgroundDim: z.number().int().min(0).max(80),
      })
      .partial()
      .strict(),
    java: z
      .object({
        mode: z.enum(['auto', 'manual']),
        memoryMaxMb: z.number().int().min(1024).max(65536),
        memoryMinMb: z.number().int().min(256).max(65536),
        jvmArgs: z.string().max(2000),
      })
      .partial()
      .strict(),
  })
  .partial()
  .strict()
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>

export const AddonTypeSchema = z.enum(['resourcepack', 'shader'])
export const AddonSearchInputSchema = z
  .object({
    type: AddonTypeSchema,
    serverId: ServerIdSchema,
    query: z.string().max(100),
    offset: z.number().int().min(0).max(1000).default(0),
  })
  .strict()
export type AddonSearchInput = z.input<typeof AddonSearchInputSchema>
export const AddonInstallInputSchema = z
  .object({
    type: AddonTypeSchema,
    serverId: ServerIdSchema,
    projectId: z.string().regex(/^[A-Za-z0-9]{2,64}$/),
  })
  .strict()
export type AddonInstallInput = z.infer<typeof AddonInstallInputSchema>
export const AddonFileInputSchema = z
  .object({
    type: AddonTypeSchema,
    serverId: ServerIdSchema,
    fileName: z
      .string()
      .max(200)
      .regex(/^[^/\\:*?"<>|\0]+\.zip$/i),
  })
  .strict()
export type AddonFileInput = z.infer<typeof AddonFileInputSchema>

export type { ServerState }
