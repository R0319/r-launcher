import { app, BrowserWindow, ipcMain, dialog, clipboard } from 'electron'
import path from 'node:path'
import type { Account } from 'eml-lib'
import { loginWithMicrosoft, refreshMicrosoftAccount } from './msAuth'
import { getDiscordAuthCode } from './discordAuth'
import { readFile, stat, writeFile } from 'node:fs/promises'
import {
  fetchPlayerStatus,
  submitDiscordCallback,
  fetchModpacks,
  adminCheck,
  adminListModpacks,
  adminCreateModpack,
  adminUpdateModpack,
  adminDeleteModpack,
  adminListMods,
  adminUpload,
  adminDelete,
  adminRegenerate,
  modrinthSearch,
  modrinthInstall,
  adminListAdmins,
  adminAddAdmin,
  adminRemoveAdmin,
} from './api'
import type { LoaderType, ModSide, Modpack } from '../shared/types'
import { loadStore, saveStore, type StoredData } from './store'
import { syncMods } from './modSync'
import { launchModpack } from './launch'
import { ensureServerRegistered } from './serversDat'
import { searchShaders, installShader, listInstalledShaders, deleteShader } from './shaderInstall'
import { resolveInstanceRoot, INSTANCE_ROOT_NAME, sanitizeRootName } from './instancePath'
import { config } from './config'
import type { LaunchProgress, SyncProgress } from '../shared/types'

// 選択中の modpack を解決する（未選択なら先頭、無ければ null）。
async function resolveSelectedModpack(): Promise<Modpack | null> {
  const data = loadStore()
  const modpacks = await fetchModpacks()
  if (modpacks.length === 0) return null
  const sel = modpacks.find((m) => m.id === data.selectedModpackId)
  return sel ?? modpacks[0]
}

let mainWindow: BrowserWindow
// ゲーム起動中フラグ（多重起動防止 + Playボタンロックの整合用）
let gameRunning = false

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 680,
    minWidth: 860,
    minHeight: 560,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
}

// レンダラーのログ画面へ1行送る（タイムスタンプ付き）。console にも出す。
function sendLog(line: string) {
  const stamped = `[${new Date().toLocaleTimeString()}] ${line}`
  console.log(stamped)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:log', stamped)
  }
}

app.whenReady().then(() => {
  createWindow()

  ipcMain.handle('app:quit', () => {
    app.quit()
  })

  ipcMain.handle('app:copy-text', (_event, text: string) => {
    clipboard.writeText(text ?? '')
  })

  // ログをファイルに保存（ダウンロード）
  ipcMain.handle('app:save-log', async (_event, text: string) => {
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'ログを保存',
      defaultPath: `r-launcher-log-${ts}.txt`,
      filters: [{ name: 'テキスト', extensions: ['txt', 'log'] }],
    })
    if (result.canceled || !result.filePath) return false
    await writeFile(result.filePath, text ?? '', 'utf-8')
    return true
  })

  // --- modpack（プレイヤー向け） ---
  ipcMain.handle('modpack:list', async () => {
    const modpacks = await fetchModpacks()
    const data = loadStore()
    const selectedId = modpacks.find((m) => m.id === data.selectedModpackId)?.id ?? modpacks[0]?.id ?? null
    return { modpacks, selectedId }
  })

  ipcMain.handle('modpack:select', (_event, modpackId: string) => {
    const data = loadStore()
    data.selectedModpackId = modpackId
    saveStore(data)
  })

  // --- シェーダー（プレイヤー各自が個別導入。同期対象外・EC2 非経由） ---
  ipcMain.handle('shader:search', async (_event, query: string) => {
    const mp = await resolveSelectedModpack()
    if (!mp) throw new Error('modpackを選択してください')
    return searchShaders(query, mp.mcVersion)
  })

  ipcMain.handle('shader:list', async () => {
    const mp = await resolveSelectedModpack()
    if (!mp) return []
    const root = resolveInstanceRoot(loadStore().settings.instanceBaseDir, mp.id)
    return listInstalledShaders(root)
  })

  ipcMain.handle('shader:install', async (_event, projectId: string) => {
    const mp = await resolveSelectedModpack()
    if (!mp) throw new Error('modpackを選択してください')
    const root = resolveInstanceRoot(loadStore().settings.instanceBaseDir, mp.id)
    const fileName = await installShader(root, projectId, mp.mcVersion)
    sendLog(`シェーダー導入(${mp.id}): ${fileName}`)
    return fileName
  })

  ipcMain.handle('shader:delete', async (_event, fileName: string) => {
    const mp = await resolveSelectedModpack()
    if (!mp) throw new Error('modpackを選択してください')
    const root = resolveInstanceRoot(loadStore().settings.instanceBaseDir, mp.id)
    await deleteShader(root, fileName)
  })

  ipcMain.handle('auth:login-microsoft', async () => {
    const account: Account = await loginWithMicrosoft(mainWindow)
    const status = await fetchPlayerStatus(account.uuid)
    const data = loadStore()
    data.account = account
    saveStore(data)
    return { mcid: account.name, uuid: account.uuid, needsDiscord: !status.registered }
  })

  ipcMain.handle('auth:login-discord', async () => {
    const data = loadStore()
    if (!data.account) throw new Error('先にMicrosoftでログインしてください')
    const code = await getDiscordAuthCode()
    const result = await submitDiscordCallback(
      code,
      data.account.uuid,
      data.account.name,
      data.account.accessToken,
    )
    data.discordId = result.discordId
    data.discordName = result.discordName
    saveStore(data)
    return { discordId: result.discordId, discordName: result.discordName }
  })

  ipcMain.handle('app:get-account', () => {
    const data = loadStore()
    if (!data.account) return null
    return {
      mcid: data.account.name,
      uuid: data.account.uuid,
      discordLinked: !!data.discordId,
      discordId: data.discordId ?? null,
      discordName: data.discordName ?? null,
    }
  })

  ipcMain.handle('app:get-settings', () => loadStore().settings)

  ipcMain.handle('app:save-settings', (_event, settings: StoredData['settings']) => {
    const data = loadStore()
    data.settings = settings
    saveStore(data)
  })

  ipcMain.handle('app:logout', () => {
    const data = loadStore()
    data.account = undefined
    data.discordId = undefined
    saveStore(data)
  })

  ipcMain.handle('play:start', async () => {
    // 多重起動防止: 既に同期/起動処理中なら弾く。
    if (gameRunning) throw new Error('すでに起動処理中です')
    gameRunning = true

    const data = loadStore()
    if (!data.account) {
      gameRunning = false
      throw new Error('ログインしていません')
    }

    const modpack = await resolveSelectedModpack()
    if (!modpack) {
      gameRunning = false
      throw new Error('参加できるmodpackがありません（管理者がmodpackを作成してください）')
    }

    let account = data.account
    const refreshed = await refreshMicrosoftAccount(mainWindow, account)
    if (refreshed !== account) {
      account = refreshed
      data.account = account
      saveStore(data)
    }

    const instanceBaseDir = data.settings.instanceBaseDir
    const instanceRoot = resolveInstanceRoot(instanceBaseDir, modpack.id)

    const sendSync = (progress: SyncProgress) => {
      mainWindow.webContents.send('play:sync-progress', progress)
    }
    const sendLaunch = (progress: LaunchProgress) => {
      mainWindow.webContents.send('play:launch-progress', progress)
    }

    try {
      sendLog(`[${modpack.name}] MOD同期を開始します`)
      await syncMods(instanceRoot, modpack.id, (p) => {
        if (p.phase === 'downloading') sendLog(`MOD DL: ${p.fileName} (${p.current}/${p.total})`)
        else if (p.phase === 'deleting') sendLog(`不要MOD削除: ${p.fileName}`)
        else if (p.phase === 'done') sendLog('MOD同期完了')
        sendSync(p)
      })
    } catch (err) {
      sendLog(`MOD同期エラー: ${(err as Error).message}`)
      sendSync({ phase: 'error', message: (err as Error).message })
      gameRunning = false
      throw err
    }

    // サーバーが設定されていれば Minecraft のサーバーリストへ自動登録
    if (modpack.serverHost) {
      try {
        ensureServerRegistered(
          instanceRoot,
          modpack.serverHost,
          modpack.serverPort ?? 25565,
          modpack.serverName ?? modpack.name,
        )
        sendLog(`サーバーをリスト登録: ${modpack.serverHost}:${modpack.serverPort ?? 25565}`)
      } catch (err) {
        sendLog(`サーバーリスト登録に失敗（続行）: ${(err as Error).message}`)
      }
    }

    try {
      sendLog(`${modpack.loader} ${modpack.mcVersion} を起動します`)
      await launchModpack(
        {
          account,
          memoryMinMb: data.settings.memoryMinMb,
          memoryMaxMb: data.settings.memoryMaxMb,
          instanceBaseDir,
          modpack,
        },
        (p) => {
          if (p.phase === 'installing_loader') sendLog(`${modpack.loader}を準備中...`)
          else if (p.phase === 'launching') sendLog('Minecraftを起動しました')
          else if (p.phase === 'closed') sendLog(`Minecraftが終了しました (code=${p.code})`)
          else if (p.phase === 'error') sendLog(`起動エラー: ${p.message}`)
          sendLaunch(p)
        },
      )
    } catch (err) {
      sendLog(`起動エラー: ${(err as Error).message}`)
      sendLaunch({ phase: 'error', message: (err as Error).message })
      gameRunning = false
      throw err
    } finally {
      gameRunning = false
    }
  })

  ipcMain.handle('app:get-server-info', () => config.mcServer)

  // --- 初回セットアップ / 保存先選択 ---
  // 表示用の基点（modpack ごとに <base>/.r-launcher/<id> が作られる）。
  const rootName = sanitizeRootName(INSTANCE_ROOT_NAME)
  const rootFolderName = process.platform === 'darwin' ? rootName : `.${rootName}`
  const displayRoot = (baseDir: string) =>
    path.join(baseDir, rootFolderName, '<modpackごと>')

  ipcMain.handle('setup:get-state', () => {
    const data = loadStore()
    return {
      setupCompleted: !!data.setupCompleted,
      instanceBaseDir: data.settings.instanceBaseDir,
      instanceRoot: displayRoot(data.settings.instanceBaseDir),
    }
  })

  // フォルダ選択ダイアログを開き、選ばれた親フォルダを保存（実データは配下の .r-launcher）。
  ipcMain.handle('setup:choose-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'ゲームデータの保存先フォルダを選択',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const baseDir = result.filePaths[0]
    const data = loadStore()
    data.settings.instanceBaseDir = baseDir
    saveStore(data)
    return { instanceBaseDir: baseDir, instanceRoot: displayRoot(baseDir) }
  })

  // 初回セットアップを完了扱いにする（既定のまま進んだ場合も含む）。
  ipcMain.handle('setup:complete', () => {
    const data = loadStore()
    data.setupCompleted = true
    saveStore(data)
  })

  // --- 管理者機能 ---
  function requireToken(): string {
    const data = loadStore()
    if (!data.account) throw new Error('ログインしていません')
    return data.account.accessToken
  }

  ipcMain.handle('admin:check', async () => {
    const data = loadStore()
    if (!data.account) return { isAdmin: false, isMaster: false }
    // MSトークンは数時間〜24hで失効する。失効した token のまま /admin/check すると
    // Minecraft profile 取得に失敗し「管理者でない」と誤判定されるため、先にリフレッシュする。
    // （requireToken を使う後続の管理者操作もこの更新後 token を読むので恩恵を受ける）
    try {
      const refreshed = await refreshMicrosoftAccount(mainWindow, data.account)
      if (refreshed !== data.account) {
        data.account = refreshed
        saveStore(data)
      }
    } catch (err) {
      sendLog(`トークン更新に失敗（再ログインが必要かもしれません）: ${(err as Error).message}`)
    }
    return adminCheck(loadStore().account!.accessToken)
  })

  // 管理者アカウント管理（マスターのみ）
  ipcMain.handle('admin:list-admins', async () => {
    return adminListAdmins(requireToken())
  })

  ipcMain.handle('admin:add-admin', async (_event, mcid: string) => {
    const result = await adminAddAdmin(requireToken(), mcid)
    sendLog(`管理者を追加: ${result.added.mcid} (${result.added.uuid})`)
    return result
  })

  ipcMain.handle('admin:remove-admin', async (_event, uuid: string) => {
    const result = await adminRemoveAdmin(requireToken(), uuid)
    sendLog(`管理者を削除: ${uuid}`)
    return result
  })

  // modpack CRUD（管理者）
  ipcMain.handle('admin:list-modpacks', async () => {
    return adminListModpacks(requireToken())
  })

  ipcMain.handle(
    'admin:create-modpack',
    async (
      _event,
      mp: { id: string; name: string; loader: LoaderType; mcVersion: string; loaderVersion: string },
    ) => {
      const modpacks = await adminCreateModpack(requireToken(), mp)
      sendLog(`modpack作成: ${mp.id} (${mp.loader} ${mp.mcVersion})`)
      return modpacks
    },
  )

  ipcMain.handle(
    'admin:update-modpack',
    async (
      _event,
      modpackId: string,
      patch: Partial<{ name: string; loader: LoaderType; mcVersion: string; loaderVersion: string }>,
    ) => {
      const mp = await adminUpdateModpack(requireToken(), modpackId, patch)
      sendLog(`modpack更新: ${modpackId}`)
      return mp
    },
  )

  ipcMain.handle('admin:delete-modpack', async (_event, modpackId: string) => {
    const modpacks = await adminDeleteModpack(requireToken(), modpackId)
    sendLog(`modpack削除: ${modpackId}`)
    return modpacks
  })

  // MOD 管理（指定 modpack）
  ipcMain.handle('admin:list-mods', async (_event, modpackId: string) => {
    return adminListMods(requireToken(), modpackId)
  })

  // ステップ1: ファイル選択ダイアログで複数の jar を選び、一覧（パス・名前・サイズ）を返す。
  ipcMain.handle('admin:pick-mods', async () => {
    requireToken()
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'アップロードするMOD (.jar) を選択（複数可）',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Minecraft MOD', extensions: ['jar'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return []
    const files = []
    for (const filePath of result.filePaths) {
      const info = await stat(filePath)
      files.push({ path: filePath, fileName: path.basename(filePath), size: info.size })
    }
    return files
  })

  // ステップ2: 選択済みの複数 jar を順にアップロードし、都度進捗を送る。
  ipcMain.handle(
    'admin:upload-mods',
    async (_event, modpackId: string, paths: string[], side: ModSide) => {
      const token = requireToken()
      let mods = null
      const total = paths.length
      for (let i = 0; i < paths.length; i++) {
        const filePath = paths[i]
        const fileName = path.basename(filePath)
        mainWindow.webContents.send('admin:upload-progress', { fileName, index: i + 1, total })
        sendLog(`MODアップロード(${modpackId}/${side}): ${fileName} (${i + 1}/${total})`)
        const buf = await readFile(filePath)
        mods = await adminUpload(token, modpackId, fileName, side, buf.toString('base64'))
      }
      return mods
    },
  )

  ipcMain.handle('admin:delete', async (_event, modpackId: string, fileName: string, side: ModSide) => {
    return adminDelete(requireToken(), modpackId, fileName, side)
  })

  ipcMain.handle('admin:regenerate', async (_event, modpackId: string) => {
    return adminRegenerate(requireToken(), modpackId)
  })

  // Modrinth 検索・ワンクリック導入
  ipcMain.handle('admin:modrinth-search', async (_event, modpackId: string, query: string) => {
    return modrinthSearch(requireToken(), modpackId, query)
  })

  ipcMain.handle(
    'admin:modrinth-install',
    async (_event, modpackId: string, projectId: string, side: ModSide) => {
      const result = await modrinthInstall(requireToken(), modpackId, projectId, side)
      sendLog(`Modrinth導入(${modpackId}/${side}): ${result.installed.join(', ')}`)
      return result
    },
  )
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
