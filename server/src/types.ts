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
  id: string // 英数字・ハイフンのみ（ディレクトリ名/URLに使う）
  name: string // 表示名
  loader: LoaderType
  mcVersion: string // 例: '1.21.1'
  loaderVersion: string // 例: '21.1.235' または 'latest'
  // 参加サーバー（任意）。設定すると Play 時に Minecraft のサーバーリストへ自動登録する。
  serverHost?: string
  serverPort?: number
  serverName?: string
}

