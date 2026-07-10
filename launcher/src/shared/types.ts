export type ModSide = 'required_both' | 'client_required' | 'client_optional' | 'server_only'

export interface ManifestEntry {
  modId: string
  fileName: string
  sha256: string
  downloadUrl: string
  side: ModSide
}

export interface Manifest {
  generatedAt: string
  mods: ManifestEntry[]
}

export type LoaderType = 'vanilla' | 'neoforge' | 'forge' | 'fabric' | 'quilt'

export interface Modpack {
  id: string
  name: string
  loader: LoaderType
  mcVersion: string
  loaderVersion: string
  serverHost?: string
  serverPort?: number
  serverName?: string
}

export type { Account as LauncherAccount } from 'eml-lib'

export interface PlayerStatus {
  registered: boolean
  uuid?: string
  mcid?: string
  discordId?: string
}

export type SyncProgress =
  | { phase: 'checking' }
  | { phase: 'downloading'; fileName: string; current: number; total: number }
  | { phase: 'deleting'; fileName: string }
  | { phase: 'done' }
  | { phase: 'error'; message: string }

export type LaunchProgress =
  | { phase: 'installing_loader' }
  // stage: EML-Lib は種別ごと(ローダー/ライブラリ/アセット等)に別々に総量を出し
  // 段階が変わると total がリセットされる。段階番号を添えてバーの戻りを明示する。
  | { phase: 'downloading'; downloadedSize: number; totalSize: number; stage: number }
  | { phase: 'launching' }
  | { phase: 'closed'; code: number | null }
  | { phase: 'error'; message: string }
