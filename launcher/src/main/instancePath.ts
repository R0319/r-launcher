import path from 'node:path'

export const INSTANCE_ROOT_NAME = 'r-launcher'

// EML-Lib は Windows/Linux で `<baseDir>/.<name>`、mac で `<baseDir>/<name>` を作る。
// modpack ごとに独立したゲームフォルダにするため、EML-Lib には
// root = "r-launcher/instances/<modpackId>" 相当を name として渡す（storage: isolated）。
// ただし EML-Lib の root は英数字以外を _ に置換するため、slug 機能で modpack を分ける。

// EML-Lib の getServerFolder は root 名の [^a-z0-9] を _ に置換する
// （'r-launcher' → 'r_launcher'）。syncMods と launch のフォルダを一致させるため同じ変換を行う。
export function sanitizeRootName(name: string): string {
  return name.replace(/[^a-z0-9]/gi, '_').toLowerCase()
}

// modpack のゲームルート（modSync が mods/ を見るため。launch と一致させる）。
// baseDir は EML-Lib が参照する APPDATA 相当。実体は <baseDir>/.r_launcher/<modpackId>。
export function resolveInstanceRoot(baseDir: string, modpackId: string): string {
  const root = sanitizeRootName(INSTANCE_ROOT_NAME)
  const rootFolder = process.platform === 'darwin' ? root : `.${root}`
  return path.join(baseDir, rootFolder, sanitizeModpackId(modpackId))
}

// EML-Lib の sanitizeSlug と同一規則にする（<baseDir>/.r-launcher/<slug> と一致させるため）。
export function sanitizeModpackId(id: string): string {
  return id
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
}
