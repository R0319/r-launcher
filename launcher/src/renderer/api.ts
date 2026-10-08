// preload が公開する操作（window.rLauncher）。テストでは setApi で偽物に差し替える。
import type { RLauncherApi } from '../shared/ipc'

declare global {
  interface Window {
    rLauncher?: RLauncherApi
  }
}

let current: RLauncherApi | undefined

export function api(): RLauncherApi {
  const value = current ?? window.rLauncher
  if (!value) throw new Error('ランチャーの本体に接続できません')
  return value
}

export function setApi(value: RLauncherApi | undefined) {
  current = value
}

/** main から返る例外の文（Electron が「Error invoking remote method …: Error: 」を前に付ける）を取り出す */
export function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const cleaned = raw.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
  return cleaned || '予期しないエラーが起きました'
}

export const loaderLabel: Record<string, string> = {
  fabric: 'Fabric',
  neoforge: 'NeoForge',
  forge: 'Forge',
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}
