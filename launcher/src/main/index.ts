// Electron のエントリ。ウィンドウとセキュリティの設定、各部品の組み立てだけを行う。
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  net,
  protocol,
  safeStorage,
  session,
  shell,
  type IpcMainInvokeEvent,
} from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { Addons } from './addons'
import { APP_INDEX, resolveAppRequest } from './appProtocol'
import { resolveBackgroundRequest } from './background'
import { config } from './config'
import { DiscordRpc } from './discordRpc'
import { Features } from './features'
import { createHttp } from './http'
import { register } from './ipcRoutes'
import { launchGame } from './launch'
import { LogBuffer } from './logs'
import { loginWithMicrosoft, refreshMicrosoftAccount } from './msAuth'
import { play, totalMemoryMb } from './play'
import { pingServer } from './serverPing'
import { LauncherService, type Platform } from './service'
import { Store } from './store'
import { initAutoUpdater, quitAndInstall } from './updater'

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: 'rl-bg', privileges: { standard: true, secure: true, supportFetchAPI: false } },
])
app.enableSandbox()
// 開発中の起動では、インストール済みの R-Launcher の設定（%APPDATA%\r-launcher）に触れない
if (!app.isPackaged) app.setPath('userData', path.join(app.getPath('appData'), 'r-launcher-dev'))

let mainWindow: BrowserWindow | undefined
const rendererDir = path.join(__dirname, '..', 'renderer')
const rendererUrl = APP_INDEX

function send(channel: string, value: unknown) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, value)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#181917',
    title: 'R-Launcher',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  })
  mainWindow.setMenuBarVisibility(false)
  void mainWindow.loadURL(rendererUrl)
}

/** 画面（main ウィンドウの、自分の index.html）からの呼び出しだけを受け付ける */
function isTrustedSender(event: IpcMainInvokeEvent) {
  const frame = event.senderFrame
  return (
    !!mainWindow &&
    event.sender === mainWindow.webContents &&
    !!frame &&
    frame === mainWindow.webContents.mainFrame &&
    frame.url.split('#')[0] === rendererUrl
  )
}

function hardenWebContents() {
  app.on('web-contents-created', (_event, contents) => {
    // 新しいウィンドウは開かせない（外部リンクは main 側で検査してから既定のブラウザで開く）
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-attach-webview', (event) => event.preventDefault())
    contents.on('will-navigate', (event, url) => {
      // ランチャー本体の画面は index.html から移動させない。
      // Microsoft のログイン画面（eml-lib が開く別ウィンドウ）は移動を許す
      if (mainWindow && contents === mainWindow.webContents && url !== rendererUrl)
        event.preventDefault()
    })
  })
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  )
  session.defaultSession.setPermissionCheckHandler(() => false)
}

function platform(logs: LogBuffer): Platform {
  const window = () => {
    if (!mainWindow) throw new Error('ウィンドウがありません')
    return mainWindow
  }
  return {
    version: app.getVersion(),
    totalMemoryMb: totalMemoryMb(),
    homeDir: os.homedir(),
    async chooseDirectory() {
      const result = await dialog.showOpenDialog(window(), {
        title: 'ゲームデータの保存先',
        properties: ['openDirectory', 'createDirectory'],
      })
      return result.canceled ? null : (result.filePaths[0] ?? null)
    },
    async chooseFile(kind) {
      const result = await dialog.showOpenDialog(window(), {
        title: kind === 'image' ? '背景にする画像' : 'Java の実行ファイル（java.exe / javaw.exe）',
        properties: ['openFile'],
        filters:
          kind === 'image'
            ? [{ name: '画像', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
            : process.platform === 'win32'
              ? [{ name: 'Java', extensions: ['exe'] }]
              : [],
      })
      return result.canceled ? null : (result.filePaths[0] ?? null)
    },
    copyText: (text) => clipboard.writeText(text),
    async saveText(defaultName, text) {
      const result = await dialog.showSaveDialog(window(), {
        defaultPath: defaultName,
        filters: [{ name: 'テキスト', extensions: ['txt'] }],
      })
      if (result.canceled || !result.filePath) return false
      await writeFile(result.filePath, text, 'utf-8')
      return true
    },
    async openPath(target) {
      const error = await shell.openPath(target)
      if (error) throw new Error('フォルダを開けませんでした')
    },
    openExternal: (url) => shell.openExternal(url),
    trash: (target) => shell.trashItem(target),
    login: () => loginWithMicrosoft(window()),
    refresh: (account) => refreshMicrosoftAccount(window(), account),
    ping: (host, port) => pingServer(host, port, { timeoutMs: 5000 }),
  }
}

function start() {
  const userData = app.getPath('userData')
  const logs = new LogBuffer(path.join(userData, 'logs'))
  const backgroundsDir = path.join(userData, 'backgrounds')
  const store = new Store(userData, {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
    decrypt: (cipher) => safeStorage.decryptString(Buffer.from(cipher, 'base64')),
  })
  const http = createHttp({
    userAgent: config.userAgent,
    allowHttpLocalhost: config.allowHttpLocalhost,
  })
  const addons = new Addons(http, (file) => shell.trashItem(file))
  const service = new LauncherService({
    store,
    http,
    addons,
    logs,
    platform: platform(logs),
    backgroundsDir,
  })
  const features = new Features(service)
  const rpc = new DiscordRpc({ clientId: config.discordAppId })

  protocol.handle('app', async (request) => {
    const target = resolveAppRequest(request.url, rendererDir)
    if (!target) return new Response('Not found', { status: 404 })
    const body = await readFile(target.file).catch(() => null)
    if (!body) return new Response('Not found', { status: 404 })
    return new Response(body, { headers: { 'Content-Type': target.type } })
  })
  protocol.handle('rl-bg', (request) => {
    const file = resolveBackgroundRequest(request.url, backgroundsDir)
    if (!file) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })

  logs.onLine((line) => send('logs:line', line))
  logs.write('launcher', `R-Launcher ${app.getVersion()} を起動しました`)

  register(
    ipcMain,
    {
      service,
      features,
      isTrustedSender,
      installUpdate: () => quitAndInstall(),
      login: () => service.login(),
      play: (serverId, force) =>
        play(
          {
            service,
            launch: launchGame,
            onPhase: (phase) => send('play:progress', phase),
            onRunning: (name) => {
              if (!service.settings.discordRichPresence) return
              void rpc.connect().then((ok) =>
                ok
                  ? rpc.setActivity({
                      details: name,
                      state: 'プレイ中',
                      startTimestamp: Date.now(),
                    })
                  : false,
              )
            },
            onExit: () => {
              void rpc.setActivity(null)
              send('play:progress', { phase: 'closed', code: null })
            },
          },
          serverId,
          force,
        ),
    },
    (text) => logs.write('launcher', text),
  )

  hardenWebContents()
  createWindow()
  initAutoUpdater(() => mainWindow)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore()
    mainWindow?.focus()
  })
  void app.whenReady().then(start)
  app.on('window-all-closed', () => app.quit())
}
