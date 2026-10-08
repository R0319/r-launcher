// 「遊ぶ」以外の操作（パック・Java・背景・Discord・ログ）。
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type {
  AddonFileInput,
  AddonInstallInput,
  AddonSearchInput,
  AppState,
  JavaView,
  LogCopyResult,
} from '../shared/ipc'
import { AddonSearchInputSchema } from '../shared/ipc'
import { importBackground } from './background'
import { linkDiscord, unlinkDiscord } from './discordLink'
import { maskLog } from './mask'
import { shaderConfigOf, type LauncherService } from './service'

export class Features {
  constructor(
    private readonly service: LauncherService,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private get deps() {
    return this.service.deps
  }

  async searchAddons(input: AddonSearchInput) {
    const parsed = AddonSearchInputSchema.parse(input)
    const manifest = await this.service.manifest(parsed.serverId)
    return this.deps.addons.search(parsed.type, parsed.query, manifest.mcVersion, parsed.offset)
  }

  async installAddon(input: AddonInstallInput) {
    const manifest = await this.service.manifest(input.serverId)
    const config = shaderConfigOf(manifest)
    if (input.type === 'shader' && !config) {
      throw new Error('このサーバーの構成には Iris / Oculus が無いので、シェーダーは使えません')
    }
    const gameDir = this.service.gameDir(input.serverId)
    const fileName = await this.deps.addons.install(
      input.type,
      input.projectId,
      manifest.mcVersion,
      gameDir,
    )
    await this.deps.addons.setEnabled(
      input.type,
      gameDir,
      config ?? 'iris.properties',
      fileName,
      true,
    )
    this.deps.logs.write(
      'launcher',
      `${input.type === 'shader' ? 'シェーダー' : 'リソースパック'}を入れました: ${fileName}`,
    )
    return this.service.detail(input.serverId)
  }

  async removeAddon(input: AddonFileInput) {
    const manifest = await this.service.manifest(input.serverId)
    const gameDir = this.service.gameDir(input.serverId)
    await this.deps.addons.remove(
      input.type,
      gameDir,
      shaderConfigOf(manifest) ?? 'iris.properties',
      input.fileName,
    )
    return this.service.detail(input.serverId)
  }

  async setAddonEnabled(input: AddonFileInput & { enabled: boolean }) {
    const manifest = await this.service.manifest(input.serverId)
    const gameDir = this.service.gameDir(input.serverId)
    const config = shaderConfigOf(manifest) ?? 'iris.properties'
    await this.deps.addons.setEnabled(input.type, gameDir, config, input.fileName, input.enabled)
    return this.service.detail(input.serverId)
  }

  async openFolder(
    serverId: string,
    folder: 'game' | 'mods' | 'resourcepacks' | 'shaderpacks' | 'logs',
  ) {
    const target =
      folder === 'logs'
        ? path.dirname(this.deps.logs.file)
        : folder === 'game'
          ? this.service.gameDir(serverId)
          : path.join(this.service.gameDir(serverId), folder)
    if (!existsSync(target)) throw new Error('まだフォルダがありません（一度遊ぶと作られます）')
    await this.deps.platform.openPath(target)
  }

  async checkJava(): Promise<JavaView> {
    const java = this.service.settings.java
    if (java.mode !== 'manual' || !java.path)
      return { mode: java.mode, path: java.path, detectedVersion: null }
    return { mode: java.mode, path: java.path, detectedVersion: await javaVersion(java.path) }
  }

  async chooseJava(): Promise<JavaView> {
    const file = await this.deps.platform.chooseFile('java')
    if (!file) return this.checkJava()
    const version = await javaVersion(file)
    if (!version) throw new Error('選んだファイルは Java として動きませんでした')
    this.deps.store.update((data) => ({
      ...data,
      settings: { ...data.settings, java: { ...data.settings.java, mode: 'manual', path: file } },
    }))
    return { mode: 'manual', path: file, detectedVersion: version }
  }

  async chooseBackground(): Promise<AppState> {
    const file = await this.deps.platform.chooseFile('image')
    if (!file) return this.service.state()
    const name = importBackground(file, this.deps.backgroundsDir)
    this.deps.store.update((data) => ({
      ...data,
      settings: { ...data.settings, appearance: { ...data.settings.appearance, background: name } },
    }))
    return this.service.state()
  }

  clearBackground(): AppState {
    this.deps.store.update((data) => ({
      ...data,
      settings: { ...data.settings, appearance: { ...data.settings.appearance, background: null } },
    }))
    return this.service.state()
  }

  private linkDeps() {
    return {
      panel: this.service.panel(),
      fetch: this.fetchImpl,
      openExternal: (url: string) => this.deps.platform.openExternal(url),
    }
  }

  async linkDiscord(): Promise<AppState> {
    const account = await this.service.freshAccount()
    const result = await linkDiscord(this.linkDeps(), account)
    this.deps.store.update((data) => ({ ...data, discord: { name: result.name } }))
    this.deps.logs.write('launcher', 'Discord と連携しました')
    return this.service.state()
  }

  async unlinkDiscord(): Promise<AppState> {
    const account = await this.service.freshAccount()
    await unlinkDiscord(this.linkDeps(), account)
    this.deps.store.update((data) => ({ ...data, discord: null }))
    return this.service.state()
  }

  /** 共有用のログ。アカウント名・ユーザーフォルダ・トークン・IP などを伏せる */
  maskedLog(): { text: string; result: LogCopyResult } {
    const data = this.deps.store.load()
    const names = [data.account?.name, data.discord?.name].filter((n): n is string => !!n)
    const masked = maskLog(this.deps.logs.text(), { names, homeDir: this.deps.platform.homeDir })
    const header = `R-Launcher ${this.deps.platform.version} のログ（個人情報は伏せてあります）\n`
    return {
      text: header + masked.text,
      result: { lines: masked.text ? masked.text.split('\n').length : 0, masked: masked.counts },
    }
  }

  copyLog(): LogCopyResult {
    const { text, result } = this.maskedLog()
    this.deps.platform.copyText(text)
    return result
  }

  async saveLog(): Promise<LogCopyResult | null> {
    const { text, result } = this.maskedLog()
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    return (await this.deps.platform.saveText(`r-launcher-log-${stamp}.txt`, text)) ? result : null
  }
}

/** java -version の 1 行目から版を取り出す。動かなければ null */
export function javaVersion(file: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(file, ['-version'], { timeout: 10000, windowsHide: true }, (error, stdout, stderr) => {
      if (error) return resolve(null)
      const match = /version "([^"]+)"/.exec(`${stderr}\n${stdout}`)
      resolve(match?.[1] ?? null)
    })
  })
}
