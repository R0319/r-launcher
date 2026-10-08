// 画面からの呼び出し（ipcRenderer.invoke）を受ける。引数はすべて zod で検証し、
// 自分の画面（main ウィンドウ）以外からの呼び出しは拒否する。
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { ServerIdSchema } from '../shared/contract'
import {
  AddonFileInputSchema,
  AddonInstallInputSchema,
  AddonSearchInputSchema,
  SettingsPatchSchema,
} from '../shared/ipc'
import type { Features } from './features'
import { parseJvmArgs } from './javaArgs'
import type { LauncherService } from './service'

type Handler = (...args: unknown[]) => unknown

export interface RouteDeps {
  service: LauncherService
  features: Features
  play: (serverId: string, force: boolean) => Promise<unknown>
  login: () => Promise<unknown>
  installUpdate: () => void
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean
}

const FolderSchema = z.enum(['game', 'mods', 'resourcepacks', 'shaderpacks', 'logs'])

export function routes(deps: RouteDeps): Record<string, Handler> {
  const { service, features } = deps
  const id = (value: unknown) => ServerIdSchema.parse(value)
  return {
    'app:state': () => service.state(),
    'app:save-settings': (patch) => service.saveSettings(SettingsPatchSchema.parse(patch)),
    'setup:choose-dir': () => service.chooseInstanceDir(),
    'setup:complete': () => service.completeSetup(),
    'auth:login': () => deps.login(),
    'auth:logout': () => service.logout(),
    'servers:list': () => service.listServers(),
    'servers:ping': (serverId) => service.ping(id(serverId)),
    'servers:detail': (serverId) => service.detail(id(serverId)),
    'servers:optional-mod': (serverId, projectId, enabled) =>
      service.setOptionalMod(
        id(serverId),
        z.string().max(64).parse(projectId),
        z.boolean().parse(enabled),
      ),
    'servers:retire-extras': (serverId) => service.retireExtraMods(id(serverId)),
    'play:start': (serverId) => deps.play(id(serverId), false),
    'play:anyway': (serverId) => deps.play(id(serverId), true),
    'addons:search': (input) => features.searchAddons(AddonSearchInputSchema.parse(input)),
    'addons:install': (input) => features.installAddon(AddonInstallInputSchema.parse(input)),
    'addons:remove': (input) => features.removeAddon(AddonFileInputSchema.parse(input)),
    'addons:enable': (input) => {
      const parsed = AddonFileInputSchema.extend({ enabled: z.boolean() }).strict().parse(input)
      return features.setAddonEnabled(parsed)
    },
    'folders:open': (serverId, folder) =>
      features.openFolder(id(serverId), FolderSchema.parse(folder)),
    'java:check': () => features.checkJava(),
    'java:choose': () => features.chooseJava(),
    'java:check-args': (text) => {
      const result = parseJvmArgs(z.string().max(2000).parse(text))
      return result.ok ? { ok: true } : result
    },
    'appearance:choose-background': () => features.chooseBackground(),
    'appearance:clear-background': () => features.clearBackground(),
    'discord:link': () => features.linkDiscord(),
    'discord:unlink': () => features.unlinkDiscord(),
    'logs:read': () => service.deps.logs.text(),
    'logs:copy': () => features.copyLog(),
    'logs:save': () => features.saveLog(),
    'update:install': () => deps.installUpdate(),
  }
}

/** 例外は日本語の文だけを画面に返す（スタックや内部のパスは返さない） */
export function register(ipcMain: IpcMain, deps: RouteDeps, log: (text: string) => void) {
  for (const [channel, handler] of Object.entries(routes(deps))) {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!deps.isTrustedSender(event)) throw new Error('許可されていない呼び出しです')
      try {
        return await handler(...args)
      } catch (error) {
        const message = userMessage(error)
        log(`[${channel}] ${message}`)
        throw new Error(message)
      }
    })
  }
}

export function userMessage(error: unknown): string {
  if (error instanceof z.ZodError) return '入力の形が正しくありません'
  if (error instanceof Error && error.message) return error.message.split('\n')[0]!.slice(0, 300)
  return '予期しないエラーが起きました'
}
