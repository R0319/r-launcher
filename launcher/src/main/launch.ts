// ゲームの起動（eml-lib）。Mod はこれより前に modSync でそろえておき、eml-lib の掃除機能は使わない
// （config/ や mods/ を勝手に消さないため）。
import EMLLib from 'eml-lib'
import type { Account } from 'eml-lib'
import type { LauncherManifest } from '../shared/contract'
import type { JavaSettings } from '../shared/settings'
import type { PlayPhase } from '../shared/ipc'
import { INSTANCE_ROOT_NAME, sanitizeModpackId } from './instancePath'

export interface LaunchInput {
  account: Account
  instanceBaseDir: string
  manifest: LauncherManifest
  java: JavaSettings
  jvmArgs: string[]
  onPhase: (phase: PlayPhase) => void
  onGameLine: (line: string) => void
  onDebug: (line: string) => void
}

/** ログに書く前に、トークンとして使われうる値を消す（ファイルにトークンを残さない） */
export function stripSecrets(line: string): string {
  return line
    .replace(/(--(?:accessToken|clientId|xuid|uuid)\s+)\S+/gi, '$1<hidden>')
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '<hidden>')
}

/** eml-lib に渡す設定（テストで中身を確かめられるよう分けておく） */
export function emlConfig(input: Omit<LaunchInput, 'onPhase' | 'onGameLine' | 'onDebug'>) {
  const { manifest, java } = input
  return {
    root: INSTANCE_ROOT_NAME,
    storage: 'isolated' as const,
    profile: {
      slug: sanitizeModpackId(manifest.id),
      minecraft: {
        version: manifest.mcVersion,
        loader: { loader: manifest.loader, version: manifest.loaderVersion },
      },
    },
    cleaning: { enabled: false },
    account: input.account,
    java:
      java.mode === 'manual' && java.path
        ? { install: 'manual' as const, absolutePath: java.path, args: input.jvmArgs }
        : { install: 'auto' as const, args: input.jvmArgs },
    memory: { min: Math.min(java.memoryMinMb, java.memoryMaxMb), max: java.memoryMaxMb },
  }
}

export async function launchGame(input: LaunchInput): Promise<void> {
  const launcher = new EMLLib.Launcher(emlConfig(input))

  // eml-lib は種類（Java・ライブラリ・アセットなど）ごとに総量を出し直すので、減ったら次の段階とみなす
  let stage = 1
  let previous = -1
  launcher.on('download_progress', ({ downloaded, total }) => {
    if (downloaded.size < previous) stage++
    previous = downloaded.size
    input.onPhase({ phase: 'game', stage, downloaded: downloaded.size, total: total.size })
  })
  launcher.on('launch_launch', () => input.onPhase({ phase: 'launching' }))
  launcher.on('launch_data', (data) => {
    input.onPhase({ phase: 'running' })
    input.onGameLine(stripSecrets(data))
  })
  launcher.on('launch_close', (code) => input.onPhase({ phase: 'closed', code }))
  launcher.on('launch_debug', (message) => input.onDebug(stripSecrets(message)))

  // eml-lib は APPDATA（Windows）/ HOME を基準にゲームフォルダを作る。起動処理の間だけ差し替えて必ず戻す
  const envKey = process.platform === 'win32' ? 'APPDATA' : 'HOME'
  const original = process.env[envKey]
  process.env[envKey] = input.instanceBaseDir
  try {
    await launcher.launch()
  } finally {
    if (original === undefined) delete process.env[envKey]
    else process.env[envKey] = original
  }
}
