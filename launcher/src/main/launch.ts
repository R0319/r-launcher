import EMLLib from 'eml-lib'
import type { Account } from 'eml-lib'
import { INSTANCE_ROOT_NAME } from './instancePath'
import { resolveLoaderVersion } from './loaderVersion'
import type { LaunchProgress, Modpack } from '../shared/types'

export interface LaunchOptions {
  account: Account
  memoryMinMb: number
  memoryMaxMb: number
  instanceBaseDir: string
  modpack: Modpack
}

// 独自のMOD同期（syncMods）で mods/ を完全一致させた後にこれを呼ぶ。
// EML-Lib自身のcleaning機能はconfig/やmods/を勝手に削除しうるため無効化し、
// MOD管理は本ランチャーのロジックに一本化する（仕様書3.4）。
export async function launchModpack(
  { account, memoryMinMb, memoryMaxMb, instanceBaseDir, modpack }: LaunchOptions,
  onProgress: (progress: LaunchProgress) => void,
): Promise<void> {
  onProgress({ phase: 'installing_loader' })

  const loaderVersion = await resolveLoaderVersion(
    modpack.loader,
    modpack.mcVersion,
    modpack.loaderVersion,
  )
  console.log(
    `[launch] modpack=${modpack.id} loader=${modpack.loader}@${loaderVersion} MC=${modpack.mcVersion}`,
  )
  console.log(`[launch] instance base dir: ${instanceBaseDir}`)

  const loaderConfig =
    modpack.loader === 'vanilla'
      ? undefined
      : { loader: modpack.loader, version: loaderVersion }

  const launcher = new EMLLib.Launcher({
    // root='r-launcher' + profile.slug=modpackId → <APPDATA>/.r-launcher/<slug> に隔離
    root: INSTANCE_ROOT_NAME,
    storage: 'isolated',
    profile: { slug: modpack.id },
    minecraft: {
      version: modpack.mcVersion,
      loader: loaderConfig,
    },
    cleaning: { enabled: false },
    account,
    java: { install: 'auto' },
    memory: { min: memoryMinMb, max: memoryMaxMb },
  })

  launcher.on('launch_install_loader', () => onProgress({ phase: 'installing_loader' }))

  // EML-Lib は種別（ローダー/ライブラリ+natives/アセット/Java）ごとに別々の総量で
  // download_progress を出すため、種別が変わると total がリセットされ downloaded も
  // 小さい値に戻る。downloaded の減少を「次の段階の開始」と見なし段階番号を進める。
  let stage = 1
  let prevDownloaded = -1
  launcher.on('download_progress', ({ downloaded, total }) => {
    if (downloaded.size < prevDownloaded) stage++
    prevDownloaded = downloaded.size
    onProgress({
      phase: 'downloading',
      downloadedSize: downloaded.size,
      totalSize: total.size,
      stage,
    })
  })
  launcher.on('launch_launch', () => onProgress({ phase: 'launching' }))
  launcher.on('launch_close', (code) => onProgress({ phase: 'closed', code }))
  launcher.on('launch_debug', (message) => console.debug('[eml-lib]', message))

  // EML-Lib は process.env.APPDATA(win)/HOME(mac/linux) を基準にゲームフォルダを作る。
  // 起動処理の間だけ基準を instanceBaseDir へ差し替え、終了後に必ず元へ戻す。
  const envKey = process.platform === 'win32' ? 'APPDATA' : 'HOME'
  const original = process.env[envKey]
  process.env[envKey] = instanceBaseDir
  try {
    await launcher.launch()
  } finally {
    if (original === undefined) delete process.env[envKey]
    else process.env[envKey] = original
  }
}
