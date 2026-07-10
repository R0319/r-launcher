import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('rLauncher', {
  loginMicrosoft: () => ipcRenderer.invoke('auth:login-microsoft'),
  loginDiscord: () => ipcRenderer.invoke('auth:login-discord'),
  getAccount: () => ipcRenderer.invoke('app:get-account'),
  getSettings: () => ipcRenderer.invoke('app:get-settings'),
  saveSettings: (settings: unknown) => ipcRenderer.invoke('app:save-settings', settings),
  logout: () => ipcRenderer.invoke('app:logout'),
  quit: () => ipcRenderer.invoke('app:quit'),
  copyText: (text: string) => ipcRenderer.invoke('app:copy-text', text),
  saveLog: (text: string) => ipcRenderer.invoke('app:save-log', text),
  getServerInfo: () => ipcRenderer.invoke('app:get-server-info'),
  listModpacks: () => ipcRenderer.invoke('modpack:list'),
  selectModpack: (id: string) => ipcRenderer.invoke('modpack:select', id),
  getSetupState: () => ipcRenderer.invoke('setup:get-state'),
  chooseFolder: () => ipcRenderer.invoke('setup:choose-folder'),
  completeSetup: () => ipcRenderer.invoke('setup:complete'),
  play: () => ipcRenderer.invoke('play:start'),
  // シェーダー（個別導入）
  shaderSearch: (query: string) => ipcRenderer.invoke('shader:search', query),
  shaderList: () => ipcRenderer.invoke('shader:list'),
  shaderInstall: (projectId: string) => ipcRenderer.invoke('shader:install', projectId),
  shaderDelete: (fileName: string) => ipcRenderer.invoke('shader:delete', fileName),
  onSyncProgress: (cb: (progress: unknown) => void) =>
    ipcRenderer.on('play:sync-progress', (_e, progress) => cb(progress)),
  onLaunchProgress: (cb: (progress: unknown) => void) =>
    ipcRenderer.on('play:launch-progress', (_e, progress) => cb(progress)),
  onLog: (cb: (line: string) => void) => ipcRenderer.on('app:log', (_e, line) => cb(line)),
  // 自動更新
  onUpdateStatus: (cb: (status: unknown) => void) =>
    ipcRenderer.on('update:status', (_e, status) => cb(status)),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  // 管理者機能
  adminCheck: () => ipcRenderer.invoke('admin:check'),
  adminListAdmins: () => ipcRenderer.invoke('admin:list-admins'),
  adminAddAdmin: (mcid: string) => ipcRenderer.invoke('admin:add-admin', mcid),
  adminRemoveAdmin: (uuid: string) => ipcRenderer.invoke('admin:remove-admin', uuid),
  adminListModpacks: () => ipcRenderer.invoke('admin:list-modpacks'),
  adminCreateModpack: (mp: unknown) => ipcRenderer.invoke('admin:create-modpack', mp),
  adminUpdateModpack: (id: string, patch: unknown) =>
    ipcRenderer.invoke('admin:update-modpack', id, patch),
  adminDeleteModpack: (id: string) => ipcRenderer.invoke('admin:delete-modpack', id),
  adminListMods: (modpackId: string) => ipcRenderer.invoke('admin:list-mods', modpackId),
  adminPickMods: () => ipcRenderer.invoke('admin:pick-mods'),
  adminUploadMods: (modpackId: string, paths: string[], side: string) =>
    ipcRenderer.invoke('admin:upload-mods', modpackId, paths, side),
  adminDelete: (modpackId: string, fileName: string, side: string) =>
    ipcRenderer.invoke('admin:delete', modpackId, fileName, side),
  adminRegenerate: (modpackId: string) => ipcRenderer.invoke('admin:regenerate', modpackId),
  modrinthSearch: (modpackId: string, query: string) =>
    ipcRenderer.invoke('admin:modrinth-search', modpackId, query),
  modrinthInstall: (modpackId: string, projectId: string, side: string) =>
    ipcRenderer.invoke('admin:modrinth-install', modpackId, projectId, side),
  onUploadProgress: (cb: (progress: unknown) => void) =>
    ipcRenderer.on('admin:upload-progress', (_e, progress) => cb(progress)),
})
