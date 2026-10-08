// 画面に公開する操作（window.rLauncher）。ipcRenderer そのものは渡さず、決まった操作だけを出す。
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { RLauncherApi } from '../shared/ipc'

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

function subscribe<T>(channel: string, cb: (value: T) => void) {
  const listener = (_event: IpcRendererEvent, value: T) => cb(value)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: RLauncherApi = {
  getState: () => invoke('app:state'),
  saveSettings: (patch) => invoke('app:save-settings', patch),
  chooseInstanceDir: () => invoke('setup:choose-dir'),
  completeSetup: () => invoke('setup:complete'),
  loginMicrosoft: () => invoke('auth:login'),
  logout: () => invoke('auth:logout'),
  listServers: () => invoke('servers:list'),
  pingServer: (serverId) => invoke('servers:ping', serverId),
  serverDetail: (serverId) => invoke('servers:detail', serverId),
  setOptionalMod: (serverId, projectId, enabled) =>
    invoke('servers:optional-mod', serverId, projectId, enabled),
  retireExtraMods: (serverId) => invoke('servers:retire-extras', serverId),
  play: (serverId) => invoke('play:start', serverId),
  playAnyway: (serverId) => invoke('play:anyway', serverId),
  searchAddons: (input) => invoke('addons:search', input),
  installAddon: (input) => invoke('addons:install', input),
  removeAddon: (input) => invoke('addons:remove', input),
  setAddonEnabled: (input) => invoke('addons:enable', input),
  openFolder: (serverId, folder) => invoke('folders:open', serverId, folder),
  checkJava: () => invoke('java:check'),
  chooseJava: () => invoke('java:choose'),
  checkJvmArgs: (text) => invoke('java:check-args', text),
  chooseBackground: () => invoke('appearance:choose-background'),
  clearBackground: () => invoke('appearance:clear-background'),
  linkDiscord: () => invoke('discord:link'),
  unlinkDiscord: () => invoke('discord:unlink'),
  readLog: () => invoke('logs:read'),
  copyLog: () => invoke('logs:copy'),
  saveLog: () => invoke('logs:save'),
  installUpdate: () => invoke('update:install'),
  onPlayProgress: (cb) => subscribe('play:progress', cb),
  onLogLine: (cb) => subscribe('logs:line', cb),
  onUpdateStatus: (cb) => subscribe('update:status', cb),
}

contextBridge.exposeInMainWorld('rLauncher', api)
