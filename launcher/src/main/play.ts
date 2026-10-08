// 「遊ぶ」の流れ: マニフェスト取得 → Mod をそろえる → 構成チェック → サーバー一覧に登録 → 起動。
// 起動したら（ゲームの終了を待たずに）結果を返す。
import os from 'node:os'
import path from 'node:path'
import type { PlayPhase, PlayResult } from '../shared/ipc'
import { DOWNLOAD_HOSTS } from './http'
import { parseJvmArgs, validateMemory } from './javaArgs'
import type { LaunchInput } from './launch'
import { applySync, planSync, readLocalJars, readManaged } from './modSync'
import { ensureServerRegistered } from './serversDat'
import { integrityView, type LauncherService } from './service'

const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000

export interface PlayDeps {
  service: LauncherService
  launch: (input: LaunchInput) => Promise<void>
  onPhase: (phase: PlayPhase) => void
  onRunning?: (serverName: string) => void
  onExit?: () => void
}

let running = false

export function isGameRunning() {
  return running
}

export async function play(deps: PlayDeps, serverId: string, force: boolean): Promise<PlayResult> {
  if (running) return { ok: false, reason: 'error', message: 'すでにゲームが起動しています' }
  running = true
  let handedOff = false
  try {
    const result = await prepareAndLaunch(deps, serverId, force, () => (handedOff = true))
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    deps.service.deps.logs.write('launcher', `起動に失敗しました: ${message}`)
    return { ok: false, reason: 'error', message }
  } finally {
    if (!handedOff) running = false
  }
}

async function prepareAndLaunch(
  deps: PlayDeps,
  serverId: string,
  force: boolean,
  handOff: () => void,
): Promise<PlayResult> {
  const { service, onPhase } = deps
  const log = (text: string) => service.deps.logs.write('launcher', text)
  const settings = service.settings
  const account = await service.freshAccount()

  const jvm = parseJvmArgs(settings.java.jvmArgs)
  if (!jvm.ok) throw new Error(`JVM 引数: ${jvm.error}`)
  const memoryProblem = validateMemory(
    settings.java.memoryMinMb,
    settings.java.memoryMaxMb,
    service.deps.platform.totalMemoryMb,
  )
  if (memoryProblem) throw new Error(memoryProblem)

  onPhase({ phase: 'manifest' })
  const manifest = await service.manifest(serverId, true)
  const gameDir = service.gameDir(serverId)
  const modsDir = path.join(gameDir, 'mods')
  log(
    `${manifest.name}（${manifest.loader} ${manifest.loaderVersion} / ${manifest.mcVersion}）を準備します`,
  )

  const plan = planSync({
    manifest,
    disabledOptional: service.disabledOptional(serverId),
    local: await readLocalJars(modsDir),
    managed: await readManaged(modsDir),
  })
  if (plan.download.length || plan.retire.length) {
    onPhase({ phase: 'mods', done: 0, total: plan.download.length })
    const synced = await applySync({
      modsDir,
      plan,
      download: (url, maxBytes) =>
        service.deps.http.getBytes(url, {
          maxBytes,
          allowedHosts: DOWNLOAD_HOSTS,
          timeoutMs: DOWNLOAD_TIMEOUT_MS,
        }),
      onProgress: (p) => onPhase({ phase: 'mods', ...p }),
    })
    log(`Mod を ${synced.installed.length} 個入れ、${synced.retired.length} 個を退避しました`)
  }

  onPhase({ phase: 'check' })
  const report = await service.integrity(serverId, manifest)
  if (report && report.verdict !== 'ok') {
    const view = integrityView(report)
    log(
      `構成チェック: ${report.verdict}（不足 ${view.missing.length}・不一致 ${view.mismatched.length}・余分 ${view.extras.filter((e) => !e.allowed).length}）`,
    )
    // block は利用者が押しても起動しない。warn は「それでも遊ぶ」で起動できる
    if (report.verdict === 'block' || !force)
      return { ok: false, reason: 'integrity', integrity: view }
  }

  ensureServerRegistered(gameDir, manifest.server.host, manifest.server.port, manifest.name)

  await new Promise<void>((resolve, reject) => {
    let started = false
    const game = deps.launch({
      account,
      instanceBaseDir: service.settings.instanceBaseDir!,
      manifest,
      java: settings.java,
      jvmArgs: jvm.args,
      onPhase: (phase) => {
        onPhase(phase)
        if (!started && (phase.phase === 'launching' || phase.phase === 'running')) {
          started = true
          handOff()
          deps.onRunning?.(manifest.name)
          resolve()
        }
      },
      onGameLine: (line) => service.deps.logs.write('game', line),
      onDebug: (line) => service.deps.logs.write('launcher', line),
    })
    game.then(
      () => {
        running = false
        deps.onExit?.()
        if (!started) reject(new Error('ゲームが起動前に終了しました'))
      },
      (error: unknown) => {
        running = false
        deps.onExit?.()
        if (!started) reject(error instanceof Error ? error : new Error(String(error)))
        else
          service.deps.logs.write(
            'launcher',
            `ゲームの終了処理で問題がありました: ${String(error)}`,
          )
      },
    )
  })
  return { ok: true }
}

/** 総メモリ（MB） */
export function totalMemoryMb() {
  return Math.floor(os.totalmem() / 1024 / 1024)
}
