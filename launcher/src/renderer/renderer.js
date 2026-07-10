// ===== 共通ユーティリティ =====
function $(id) {
  return document.getElementById(id)
}
function setText(id, text) {
  $(id).textContent = text
}

const preauthScreens = {
  setup: $('screen-setup'),
  login: $('screen-login'),
  discord: $('screen-discord'),
}

// 認証前のフルスクリーン画面を表示（app-shell は隠す）。
function showPreauth(name) {
  $('app-shell').classList.add('hidden')
  $('preauth').classList.remove('hidden')
  for (const key of Object.keys(preauthScreens)) {
    preauthScreens[key].classList.toggle('hidden', key !== name)
  }
}

// 認証後のシェル（サイドバー＋コンテンツ）を表示し、指定パネルを開く。
function showShell(panel = 'play') {
  $('preauth').classList.add('hidden')
  $('app-shell').classList.remove('hidden')
  selectPanel(panel)
}

function selectPanel(panel) {
  document.querySelectorAll('.nav-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.panel === panel)
  })
  document.querySelectorAll('.panel').forEach((el) => {
    el.classList.toggle('active', el.dataset.panel === panel)
  })
}

document.querySelectorAll('.nav-item').forEach((el) => {
  el.addEventListener('click', async () => {
    selectPanel(el.dataset.panel)
    // プレイタブを開くたび modpack 一覧を再取得（管理画面での作成/削除を反映）
    if (el.dataset.panel === 'play') await loadPlayModpacks()
    if (el.dataset.panel === 'shader') {
      await loadInstalledShaders()
      // 初回オープン時は人気シェーダー一覧を自動表示（名前を知らなくても選べるように）
      if (!$('shader-results').dataset.loaded) await runShaderSearch()
    }
  })
})

// ===== ログ =====
function appendLog(line) {
  const out = $('log-output')
  out.textContent += line + '\n'
  out.scrollTop = out.scrollHeight
}
window.rLauncher.onLog((line) => appendLog(line))

// ===== 自動更新バナー =====
window.rLauncher.onUpdateStatus((status) => {
  const banner = $('update-banner')
  const text = $('update-banner-text')
  const installBtn = $('update-banner-install')
  installBtn.classList.add('hidden')
  switch (status.state) {
    case 'available':
      banner.classList.remove('hidden')
      text.textContent = `新しいバージョン ${status.version} が見つかりました。ダウンロード中...`
      break
    case 'downloading':
      banner.classList.remove('hidden')
      text.textContent = `更新をダウンロード中... ${status.percent}%`
      break
    case 'downloaded':
      banner.classList.remove('hidden')
      text.textContent = `バージョン ${status.version} の準備ができました。`
      installBtn.classList.remove('hidden')
      break
    case 'error':
      // 更新チェック失敗は致命的でないので控えめに（バナーは出さない）
      console.warn('update error:', status.message)
      break
    default:
      // checking / none はバナーを出さない
      banner.classList.add('hidden')
  }
})
$('update-banner-install').addEventListener('click', () => window.rLauncher.installUpdate())
$('btn-log-clear').addEventListener('click', () => {
  $('log-output').textContent = ''
})
$('btn-log-copy').addEventListener('click', async () => {
  await window.rLauncher.copyText($('log-output').textContent)
  const btn = $('btn-log-copy')
  const orig = btn.textContent
  btn.textContent = 'コピーしました'
  setTimeout(() => {
    btn.textContent = orig
  }, 1200)
})
$('btn-log-download').addEventListener('click', async () => {
  const ok = await window.rLauncher.saveLog($('log-output').textContent)
  const btn = $('btn-log-download')
  if (ok) {
    const orig = btn.textContent
    btn.textContent = '保存しました'
    setTimeout(() => {
      btn.textContent = orig
    }, 1200)
  }
})

// ===== 終了 =====
$('btn-quit').addEventListener('click', () => window.rLauncher.quit())

// ===== Discordバッジ / アカウント表示 =====
function renderAccount(account) {
  if (!account) return
  setText('sb-mcid', account.mcid)
  $('sb-avatar').textContent = (account.mcid || '?').charAt(0).toUpperCase()

  const badge = $('discord-status-badge')
  const idText = $('discord-id-text')
  const linkBtn = $('btn-link-discord-main')
  if (account.discordLinked) {
    badge.textContent = '連携済み'
    badge.className = 'badge badge-linked'
    idText.textContent = account.discordName ? `@${account.discordName}` : ''
    setText('sb-discord', account.discordName ? `@${account.discordName}` : '連携済み')
    linkBtn.classList.add('hidden')
  } else {
    badge.textContent = '未連携'
    badge.className = 'badge badge-unlinked'
    idText.textContent = ''
    setText('sb-discord', '未連携')
    linkBtn.classList.remove('hidden')
  }
}

let gameBusy = false
function setPlayLock(locked, label) {
  gameBusy = locked
  const btn = $('btn-play')
  btn.disabled = locked
  btn.textContent = locked ? label ?? '起動中...' : 'PLAY'
}

// プレイ画面の modpack セレクタを埋める。
let playModpacks = []
async function loadPlayModpacks() {
  const sel = $('play-modpack-select')
  try {
    const { modpacks, selectedId } = await window.rLauncher.listModpacks()
    playModpacks = modpacks
    sel.innerHTML = ''
    if (modpacks.length === 0) {
      const opt = document.createElement('option')
      opt.textContent = '（modpackがありません）'
      opt.value = ''
      sel.appendChild(opt)
      setText('play-version', '管理者がmodpackを作成してください')
      $('btn-play').disabled = true
      return
    }
    for (const mp of modpacks) {
      const opt = document.createElement('option')
      opt.value = mp.id
      opt.textContent = mp.name
      if (mp.id === selectedId) opt.selected = true
      sel.appendChild(opt)
    }
    renderPlayVersion(selectedId)
    if (!gameBusy) $('btn-play').disabled = false
  } catch (err) {
    setText('play-version', `modpack取得失敗: ${err.message ?? err}`)
  }
}

function renderPlayVersion(id) {
  const mp = playModpacks.find((m) => m.id === id)
  if (mp) {
    const server = mp.serverHost ? ` ・ サーバー: ${mp.serverHost}:${mp.serverPort ?? 25565}` : ''
    setText('play-version', `${mp.loader} ・ Minecraft ${mp.mcVersion}（${mp.loaderVersion}）${server}`)
  }
}

$('play-modpack-select').addEventListener('change', async (e) => {
  await window.rLauncher.selectModpack(e.target.value)
  renderPlayVersion(e.target.value)
})

// メイン（プレイ）へ遷移し、アカウント・管理者判定・modpackを反映。
async function enterShell() {
  const account = await window.rLauncher.getAccount()
  renderAccount(account)
  $('btn-play').disabled = gameBusy

  await loadPlayModpacks()

  showShell('play')

  // 管理者なら MOD管理ナビを表示。
  try {
    const admin = await window.rLauncher.adminCheck()
    isMaster = !!admin.isMaster
    $('nav-admin').classList.toggle('hidden', !admin.isAdmin)
  } catch {
    isMaster = false
    $('nav-admin').classList.add('hidden')
  }
}

async function goToLoggedInOrLogin() {
  const account = await window.rLauncher.getAccount()
  if (account) await enterShell()
  else showPreauth('login')
}

// ===== 初回セットアップ =====
async function showSetupScreen() {
  const state = await window.rLauncher.getSetupState()
  $('setup-base-dir').value = state.instanceBaseDir
  setText('setup-instance-root', state.instanceRoot)
  showPreauth('setup')
}

$('btn-setup-choose').addEventListener('click', async () => {
  const result = await window.rLauncher.chooseFolder()
  if (result) {
    $('setup-base-dir').value = result.instanceBaseDir
    setText('setup-instance-root', result.instanceRoot)
  }
})
$('btn-setup-next').addEventListener('click', async () => {
  await window.rLauncher.completeSetup()
  await goToLoggedInOrLogin()
})

// ===== ログイン / Discord =====
$('btn-login-microsoft').addEventListener('click', async () => {
  setText('login-status', 'ログイン中...')
  try {
    const result = await window.rLauncher.loginMicrosoft()
    if (result.needsDiscord) showPreauth('discord')
    else await enterShell()
  } catch (err) {
    setText('login-status', `ログインに失敗しました: ${err.message ?? err}`)
  }
})

$('btn-login-discord').addEventListener('click', async () => {
  setText('discord-status', '連携中...')
  try {
    await window.rLauncher.loginDiscord()
    await enterShell()
  } catch (err) {
    setText('discord-status', `連携に失敗しました: ${err.message ?? err}`)
  }
})

$('btn-link-discord-main').addEventListener('click', async () => {
  setText('play-status', 'Discord連携中...')
  try {
    await window.rLauncher.loginDiscord()
    const account = await window.rLauncher.getAccount()
    renderAccount(account)
    setText('play-status', 'Discord連携が完了しました。')
  } catch (err) {
    setText('play-status', `連携に失敗しました: ${err.message ?? err}`)
  }
})

$('btn-logout').addEventListener('click', async () => {
  await window.rLauncher.logout()
  showPreauth('login')
})

// ===== 設定 =====
let editingBaseDir = ''
async function loadSettingsPanel() {
  const settings = await window.rLauncher.getSettings()
  const state = await window.rLauncher.getSetupState()
  $('setting-mem-min').value = settings.memoryMinMb
  $('setting-mem-max').value = settings.memoryMaxMb
  editingBaseDir = settings.instanceBaseDir
  $('setting-base-dir').value = settings.instanceBaseDir
  setText('setting-instance-root', state.instanceRoot)
  $('setting-log').value = settings.logDir
}
// 設定タブを開いたら最新値を反映。
document.querySelector('.nav-item[data-panel="settings"]').addEventListener('click', loadSettingsPanel)

$('btn-settings-choose').addEventListener('click', async () => {
  const result = await window.rLauncher.chooseFolder()
  if (result) {
    editingBaseDir = result.instanceBaseDir
    $('setting-base-dir').value = result.instanceBaseDir
    setText('setting-instance-root', result.instanceRoot)
  }
})

$('btn-save-settings').addEventListener('click', async () => {
  await window.rLauncher.saveSettings({
    memoryMinMb: Number($('setting-mem-min').value),
    memoryMaxMb: Number($('setting-mem-max').value),
    instanceBaseDir: editingBaseDir,
    logDir: $('setting-log').value,
  })
  setText('play-status', '')
  selectPanel('play')
})

// ===== MOD管理 =====
const SIDE_LABELS = {
  required_both: 'required_both（両方必須）',
  client_required: 'client_required（クライアント必須）',
  server_only: 'server_only（サーバー専用）',
}
const SIDE_ORDER = ['required_both', 'client_required', 'server_only']

function fmtSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

// アップロード待ちの選択済みファイル一覧
let pendingFiles = []

function renderPending() {
  const list = $('admin-pending-list')
  list.innerHTML = ''
  $('btn-admin-upload').disabled = pendingFiles.length === 0
  for (const f of pendingFiles) {
    const row = document.createElement('div')
    row.className = 'pending-item'
    const name = document.createElement('span')
    name.textContent = `${f.fileName} (${fmtSize(f.size)})`
    const rm = document.createElement('button')
    rm.className = 'rm'
    rm.textContent = '除外'
    rm.addEventListener('click', () => {
      pendingFiles = pendingFiles.filter((x) => x.path !== f.path)
      renderPending()
    })
    row.appendChild(name)
    row.appendChild(rm)
    list.appendChild(row)
  }
}

function renderModList(mods) {
  const list = $('admin-mod-list')
  const summary = $('admin-summary')
  list.innerHTML = ''
  summary.innerHTML = ''

  if (!mods || mods.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'admin-mod-empty'
    empty.textContent = '登録されているMODはありません。'
    list.appendChild(empty)
    return
  }

  // side別に件数チップ
  const counts = { required_both: 0, client_required: 0, server_only: 0 }
  for (const m of mods) counts[m.side] = (counts[m.side] ?? 0) + 1
  const total = document.createElement('span')
  total.className = 'summary-chip'
  total.innerHTML = `合計 <b>${mods.length}</b> 個`
  summary.appendChild(total)
  for (const side of SIDE_ORDER) {
    const chip = document.createElement('span')
    chip.className = 'summary-chip'
    chip.innerHTML = `${side}: <b>${counts[side]}</b>`
    summary.appendChild(chip)
  }

  // side別にグルーピングして表示
  for (const side of SIDE_ORDER) {
    const inSide = mods.filter((m) => m.side === side)
    if (inSide.length === 0) continue
    const header = document.createElement('div')
    header.className = 'mod-group-header'
    header.textContent = `${SIDE_LABELS[side]} — ${inSide.length}個`
    list.appendChild(header)
    for (const mod of inSide) {
      const row = document.createElement('div')
      row.className = 'admin-mod-row'
      const name = document.createElement('span')
      name.className = 'admin-mod-name'
      name.textContent = mod.fileName
      const del = document.createElement('button')
      del.className = 'btn-delete'
      del.textContent = '削除'
      del.addEventListener('click', async () => {
        if (!adminSelectedId) return
        setText('admin-status', `${mod.fileName} を削除中...`)
        try {
          const updated = await window.rLauncher.adminDelete(adminSelectedId, mod.fileName, mod.side)
          renderModList(updated)
          setText('admin-status', `${mod.fileName} を削除しました。`)
        } catch (err) {
          setText('admin-status', `削除に失敗しました: ${err.message ?? err}`)
        }
      })
      row.appendChild(name)
      row.appendChild(del)
      list.appendChild(row)
    }
  }
}

// ===== modpack 管理 =====
let adminModpacks = []
let adminSelectedId = null
let isMaster = false

function renderModpackMeta() {
  const mp = adminModpacks.find((m) => m.id === adminSelectedId)
  if (!mp) {
    $('modpack-meta').innerHTML = 'modpackがありません。「＋ 新規modpack」で作成してください。'
    return
  }
  const server = mp.serverHost
    ? ` ／ サーバー: <b>${mp.serverHost}:${mp.serverPort ?? 25565}</b>`
    : ' ／ サーバー: <b>未設定</b>'
  $('modpack-meta').innerHTML =
    `ID: <b>${mp.id}</b> ／ ローダー: <b>${mp.loader}</b> ／ MC: <b>${mp.mcVersion}</b> ／ ローダー版: <b>${mp.loaderVersion}</b>${server}`
}

function fillModpackSelect() {
  const sel = $('admin-modpack-select')
  sel.innerHTML = ''
  for (const mp of adminModpacks) {
    const opt = document.createElement('option')
    opt.value = mp.id
    opt.textContent = `${mp.name} (${mp.id})`
    if (mp.id === adminSelectedId) opt.selected = true
    sel.appendChild(opt)
  }
}

async function loadAdminPanel() {
  setText('admin-status', '読み込み中...')
  try {
    adminModpacks = await window.rLauncher.adminListModpacks()
    if (adminModpacks.length > 0 && !adminModpacks.some((m) => m.id === adminSelectedId)) {
      adminSelectedId = adminModpacks[0].id
    }
    fillModpackSelect()
    renderModpackMeta()
    await refreshModList()
    setText('admin-status', '')
  } catch (err) {
    setText('admin-status', `読み込みに失敗しました: ${err.message ?? err}`)
  }
  // 管理者管理セクションはマスターにだけ表示。
  $('admin-master-section').classList.toggle('hidden', !isMaster)
  if (isMaster) await loadAdmins()
}

// ===== 管理者アカウント管理（マスターのみ） =====
function renderAdmins(masters, admins) {
  const box = $('admin-list')
  box.innerHTML = ''
  for (const uuid of masters) {
    const row = document.createElement('div')
    row.className = 'admin-mod-row'
    const name = document.createElement('span')
    name.className = 'admin-mod-name'
    name.textContent = `${uuid}  👑 マスター`
    row.appendChild(name)
    box.appendChild(row)
  }
  for (const a of admins) {
    const row = document.createElement('div')
    row.className = 'admin-mod-row'
    const name = document.createElement('span')
    name.className = 'admin-mod-name'
    name.textContent = `${a.mcid}  (${a.uuid})`
    const del = document.createElement('button')
    del.className = 'btn-delete'
    del.textContent = '削除'
    del.addEventListener('click', async () => {
      del.disabled = true
      try {
        const res = await window.rLauncher.adminRemoveAdmin(a.uuid)
        renderAdmins(masters, res.admins)
        setText('admin-manage-status', `${a.mcid} を管理者から外しました。`)
      } catch (err) {
        setText('admin-manage-status', `削除に失敗: ${err.message ?? err}`)
        del.disabled = false
      }
    })
    row.appendChild(name)
    row.appendChild(del)
    box.appendChild(row)
  }
  if (admins.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'admin-mod-empty'
    empty.textContent = 'マスター以外の管理者はいません。'
    box.appendChild(empty)
  }
}

async function loadAdmins() {
  try {
    const { masters, admins } = await window.rLauncher.adminListAdmins()
    renderAdmins(masters, admins)
  } catch (err) {
    setText('admin-manage-status', `管理者一覧の取得に失敗: ${err.message ?? err}`)
  }
}

async function addAdminByMcid() {
  const input = $('admin-add-mcid')
  const mcid = input.value.trim()
  if (!mcid) return
  setText('admin-manage-status', `${mcid} を追加中...`)
  try {
    const res = await window.rLauncher.adminAddAdmin(mcid)
    input.value = ''
    await loadAdmins()
    setText('admin-manage-status', `管理者に追加しました: ${res.added.mcid}`)
  } catch (err) {
    setText('admin-manage-status', `追加に失敗: ${err.message ?? err}`)
  }
}

async function refreshModList() {
  if (!adminSelectedId) {
    renderModList([])
    return
  }
  const mods = await window.rLauncher.adminListMods(adminSelectedId)
  renderModList(mods)
}

$('nav-admin').addEventListener('click', loadAdminPanel)

$('btn-admin-add').addEventListener('click', addAdminByMcid)
$('admin-add-mcid').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addAdminByMcid()
})

$('admin-modpack-select').addEventListener('change', async (e) => {
  adminSelectedId = e.target.value
  renderModpackMeta()
  await refreshModList()
})

// modpack 作成/編集フォーム
let editingModpackId = null // null=新規, id=編集
function openModpackForm(mp) {
  editingModpackId = mp ? mp.id : null
  $('mp-id').value = mp ? mp.id : ''
  $('mp-id').disabled = !!mp // 編集時はID変更不可
  $('mp-name').value = mp ? mp.name : ''
  $('mp-loader').value = mp ? mp.loader : 'neoforge'
  $('mp-mcver').value = mp ? mp.mcVersion : '1.21.1'
  $('mp-loaderver').value = mp ? mp.loaderVersion : 'latest'
  // ポートが既定(25565)以外なら「ホスト:ポート」の形で1欄に表示する。
  $('mp-serverhost').value =
    mp && mp.serverHost
      ? mp.serverPort && mp.serverPort !== 25565
        ? `${mp.serverHost}:${mp.serverPort}`
        : mp.serverHost
      : ''
  $('mp-servername').value = mp && mp.serverName ? mp.serverName : ''
  setText('modpack-form-status', '')
  $('modpack-form').classList.remove('hidden')
}

$('btn-modpack-new').addEventListener('click', () => openModpackForm(null))
$('btn-modpack-edit').addEventListener('click', () => {
  const mp = adminModpacks.find((m) => m.id === adminSelectedId)
  if (mp) openModpackForm(mp)
})
$('btn-modpack-cancel').addEventListener('click', () => $('modpack-form').classList.add('hidden'))

// サーバーのエラーコードを日本語に翻訳。
function friendlyError(raw) {
  const s = String(raw)
  if (s.includes('invalid_id')) return 'IDは英小文字・数字・ハイフンのみ使えます（例: main, sky-pack）'
  if (s.includes('missing_params')) return 'ID・表示名・MCバージョンは必須です'
  if (s.includes('invalid_loader')) return 'ローダーの指定が不正です'
  if (s.includes('409')) return 'そのIDのmodpackは既に存在します'
  return s
}

// 「ホスト」または「ホスト:ポート」を分解する。ポート未指定/不正なら port は undefined。
function parseHostPort(raw) {
  const s = (raw ?? '').trim()
  if (!s) return { host: '', port: undefined }
  const idx = s.lastIndexOf(':')
  if (idx > 0) {
    const host = s.slice(0, idx).trim()
    const portStr = s.slice(idx + 1).trim()
    const port = Number(portStr)
    if (portStr && Number.isInteger(port) && port > 0 && port <= 65535) {
      return { host, port }
    }
  }
  return { host: s, port: undefined }
}

$('btn-modpack-save').addEventListener('click', async () => {
  const { host: serverHost, port: serverPort } = parseHostPort($('mp-serverhost').value)
  const body = {
    id: $('mp-id').value.trim(),
    name: $('mp-name').value.trim(),
    loader: $('mp-loader').value,
    mcVersion: $('mp-mcver').value.trim(),
    loaderVersion: $('mp-loaderver').value.trim() || 'latest',
    serverHost,
    serverPort,
    serverName: $('mp-servername').value.trim(),
  }

  // クライアント側で事前チェック（フォーム内に分かりやすいメッセージを出す）
  if (!editingModpackId) {
    if (!body.id) {
      setText('modpack-form-status', 'IDを入力してください（英小文字・数字・ハイフンのみ）')
      return
    }
    if (!/^[a-z0-9-]+$/.test(body.id)) {
      setText('modpack-form-status', 'IDは英小文字・数字・ハイフンのみ（例: main, sky-pack）')
      return
    }
  }
  if (!body.name) {
    setText('modpack-form-status', '表示名を入力してください')
    return
  }
  if (!body.mcVersion) {
    setText('modpack-form-status', 'MCバージョンを入力してください（例: 1.21.1）')
    return
  }

  setText('modpack-form-status', '保存中...')
  try {
    if (editingModpackId) {
      await window.rLauncher.adminUpdateModpack(editingModpackId, {
        name: body.name,
        loader: body.loader,
        mcVersion: body.mcVersion,
        loaderVersion: body.loaderVersion,
        serverHost: body.serverHost,
        serverPort: body.serverPort,
        serverName: body.serverName,
      })
    } else {
      adminSelectedId = body.id
      await window.rLauncher.adminCreateModpack(body)
    }
    setText('modpack-form-status', '')
    $('modpack-form').classList.add('hidden')
    await loadAdminPanel()
    setText('admin-status', '保存しました。')
  } catch (err) {
    setText('modpack-form-status', `保存に失敗: ${friendlyError(err.message ?? err)}`)
  }
})

$('btn-modpack-delete').addEventListener('click', async () => {
  if (!adminSelectedId) return
  const mp = adminModpacks.find((m) => m.id === adminSelectedId)
  if (!mp) return
  if (!confirm(`modpack「${mp.name}」を削除しますか？MODファイルも全て削除されます。`)) return
  setText('admin-status', '削除中...')
  try {
    adminModpacks = await window.rLauncher.adminDeleteModpack(adminSelectedId)
    adminSelectedId = adminModpacks[0]?.id ?? null
    fillModpackSelect()
    renderModpackMeta()
    await refreshModList()
    setText('admin-status', 'modpackを削除しました。')
  } catch (err) {
    setText('admin-status', `削除に失敗しました: ${err.message ?? err}`)
  }
})

$('btn-admin-pick').addEventListener('click', async () => {
  const files = await window.rLauncher.adminPickMods()
  if (files && files.length > 0) {
    const seen = new Set(pendingFiles.map((f) => f.path))
    for (const f of files) if (!seen.has(f.path)) pendingFiles.push(f)
    renderPending()
    setText('admin-status', `${pendingFiles.length}個のMODを選択中。分類を選んでアップロードしてください。`)
  }
})

$('btn-admin-upload').addEventListener('click', async () => {
  if (pendingFiles.length === 0) return
  if (!adminSelectedId) {
    setText('admin-status', '先にmodpackを選択/作成してください。')
    return
  }
  const side = $('admin-upload-side').value
  const paths = pendingFiles.map((f) => f.path)
  setText('admin-status', 'アップロード中...')
  $('btn-admin-upload').disabled = true
  try {
    const mods = await window.rLauncher.adminUploadMods(adminSelectedId, paths, side)
    pendingFiles = []
    renderPending()
    renderModList(mods)
    setText('admin-status', 'アップロードして manifest に反映しました。')
  } catch (err) {
    setText('admin-status', `アップロードに失敗しました: ${err.message ?? err}`)
    $('btn-admin-upload').disabled = pendingFiles.length === 0
  }
})

window.rLauncher.onUploadProgress((p) => {
  setText('admin-status', `アップロード中: ${p.fileName} (${p.index}/${p.total})`)
})

$('btn-admin-regenerate').addEventListener('click', async () => {
  if (!adminSelectedId) return
  setText('admin-status', 'manifest再生成中...')
  try {
    const count = await window.rLauncher.adminRegenerate(adminSelectedId)
    setText('admin-status', `manifestを再生成しました（MOD数: ${count}）。`)
  } catch (err) {
    setText('admin-status', `再生成に失敗しました: ${err.message ?? err}`)
  }
})

// ===== Modrinth 検索＆導入 =====
function renderModrinthResults(hits) {
  const box = $('modrinth-results')
  box.innerHTML = ''
  if (!hits || hits.length === 0) {
    box.innerHTML = '<div class="admin-mod-empty">該当するMODが見つかりませんでした。</div>'
    return
  }
  for (const hit of hits) {
    const card = document.createElement('div')
    card.className = 'modrinth-card'

    if (hit.iconUrl) {
      const img = document.createElement('img')
      img.className = 'modrinth-icon'
      img.src = hit.iconUrl
      img.onerror = () => img.remove()
      card.appendChild(img)
    }

    const info = document.createElement('div')
    info.className = 'modrinth-info'
    const title = document.createElement('div')
    title.className = 'modrinth-title'
    title.textContent = hit.title
    const desc = document.createElement('div')
    desc.className = 'modrinth-desc'
    desc.textContent = hit.description
    const meta = document.createElement('div')
    meta.className = 'modrinth-meta'
    meta.textContent = `DL ${hit.downloads.toLocaleString()} ・ ${hit.categories.join(', ')}`
    info.appendChild(title)
    info.appendChild(desc)
    info.appendChild(meta)
    card.appendChild(info)

    const btn = document.createElement('button')
    btn.className = 'btn-primary btn-sm'
    btn.textContent = '導入'
    btn.addEventListener('click', async () => {
      const side = $('modrinth-side').value
      btn.disabled = true
      btn.textContent = '導入中...'
      setText('admin-status', `${hit.title} を導入中...`)
      try {
        const res = await window.rLauncher.modrinthInstall(adminSelectedId, hit.projectId, side)
        renderModList(res.mods)
        setText('admin-status', `導入しました: ${res.installed.join(', ')}`)
        btn.textContent = '導入済み'
      } catch (err) {
        setText('admin-status', `導入に失敗しました: ${err.message ?? err}`)
        btn.disabled = false
        btn.textContent = '導入'
      }
    })
    card.appendChild(btn)
    box.appendChild(card)
  }
}

async function runModrinthSearch() {
  if (!adminSelectedId) {
    setText('admin-status', '先にmodpackを選択してください。')
    return
  }
  const query = $('modrinth-query').value.trim()
  setText('admin-status', 'Modrinthを検索中...')
  try {
    const hits = await window.rLauncher.modrinthSearch(adminSelectedId, query)
    renderModrinthResults(hits)
    setText('admin-status', `${hits.length}件見つかりました。`)
  } catch (err) {
    setText('admin-status', `検索に失敗しました: ${err.message ?? err}`)
  }
}

$('btn-modrinth-search').addEventListener('click', runModrinthSearch)
$('modrinth-query').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runModrinthSearch()
})

// ===== Play =====
function renderProgressBar(ratio) {
  $('progress-bar-wrap').classList.remove('hidden')
  $('progress-bar').style.width = `${Math.min(100, Math.max(0, ratio * 100))}%`
}

window.rLauncher.onSyncProgress((progress) => {
  switch (progress.phase) {
    case 'checking':
      setText('play-status', 'MODを確認中...')
      break
    case 'downloading':
      setText('play-status', `MODダウンロード中: ${progress.fileName} (${progress.current}/${progress.total})`)
      renderProgressBar(progress.current / Math.max(1, progress.total))
      break
    case 'deleting':
      setText('play-status', `不要なMODを削除中: ${progress.fileName}`)
      break
    case 'done':
      setText('play-status', 'MOD同期完了。起動準備中...')
      break
    case 'error':
      setText('play-status', `MOD同期に失敗しました: ${progress.message}`)
      setPlayLock(false)
      break
  }
})

window.rLauncher.onLaunchProgress((progress) => {
  switch (progress.phase) {
    case 'installing_loader':
      setText('play-status', 'NeoForgeを準備中...')
      setPlayLock(true, '準備中...')
      break
    case 'downloading': {
      const mb = (n) => (n / 1024 / 1024).toFixed(1)
      const stageLabel = progress.stage > 1 ? `（段階 ${progress.stage}）` : ''
      setText(
        'play-status',
        `ゲームファイルをダウンロード中${stageLabel}: ${mb(progress.downloadedSize)} / ${mb(progress.totalSize)} MB`,
      )
      renderProgressBar(progress.downloadedSize / Math.max(1, progress.totalSize))
      break
    }
    case 'launching':
      setText('play-status', 'Minecraftを起動しました（プレイ中）')
      setPlayLock(true, 'プレイ中...')
      break
    case 'closed':
      setText('play-status', 'Minecraftを終了しました。')
      setPlayLock(false)
      $('progress-bar-wrap').classList.add('hidden')
      break
    case 'error':
      setText('play-status', `起動に失敗しました: ${progress.message}`)
      setPlayLock(false)
      break
  }
})

$('btn-play').addEventListener('click', async () => {
  if (gameBusy) return
  setPlayLock(true, '準備中...')
  setText('play-status', '準備中...')
  try {
    await window.rLauncher.play()
  } catch (err) {
    setText('play-status', `エラー: ${err.message ?? err}`)
    setPlayLock(false)
  }
})

// ===== シェーダー（個別導入） =====
async function loadInstalledShaders() {
  const box = $('shader-installed')
  box.innerHTML = ''
  let files = []
  try {
    files = await window.rLauncher.shaderList()
  } catch {
    files = []
  }
  if (files.length === 0) {
    box.innerHTML = '<div class="admin-mod-empty">導入済みシェーダーはありません。</div>'
    return
  }
  for (const fileName of files) {
    const row = document.createElement('div')
    row.className = 'admin-mod-row'
    const name = document.createElement('span')
    name.className = 'admin-mod-name'
    name.textContent = fileName
    const del = document.createElement('button')
    del.className = 'btn-delete'
    del.textContent = '削除'
    del.addEventListener('click', async () => {
      try {
        await window.rLauncher.shaderDelete(fileName)
        await loadInstalledShaders()
        setText('shader-status', `${fileName} を削除しました。`)
      } catch (err) {
        setText('shader-status', `削除に失敗: ${err.message ?? err}`)
      }
    })
    row.appendChild(name)
    row.appendChild(del)
    box.appendChild(row)
  }
}

function renderShaderResults(hits) {
  const box = $('shader-results')
  box.innerHTML = ''
  if (!hits || hits.length === 0) {
    box.innerHTML = '<div class="admin-mod-empty">該当するシェーダーが見つかりませんでした。</div>'
    return
  }
  for (const hit of hits) {
    const card = document.createElement('div')
    card.className = 'modrinth-card'
    if (hit.iconUrl) {
      const img = document.createElement('img')
      img.className = 'modrinth-icon'
      img.src = hit.iconUrl
      img.onerror = () => img.remove()
      card.appendChild(img)
    }
    const info = document.createElement('div')
    info.className = 'modrinth-info'
    const title = document.createElement('div')
    title.className = 'modrinth-title'
    title.textContent = hit.title
    const desc = document.createElement('div')
    desc.className = 'modrinth-desc'
    desc.textContent = hit.description
    const meta = document.createElement('div')
    meta.className = 'modrinth-meta'
    meta.textContent = `DL ${hit.downloads.toLocaleString()}`
    info.appendChild(title)
    info.appendChild(desc)
    info.appendChild(meta)
    card.appendChild(info)

    const btn = document.createElement('button')
    btn.className = 'btn-primary btn-sm'
    btn.textContent = '導入'
    btn.addEventListener('click', async () => {
      btn.disabled = true
      btn.textContent = '導入中...'
      setText('shader-status', `${hit.title} を導入中...`)
      try {
        const fileName = await window.rLauncher.shaderInstall(hit.projectId)
        await loadInstalledShaders()
        setText('shader-status', `導入しました: ${fileName}`)
        btn.textContent = '導入済み'
      } catch (err) {
        setText('shader-status', `導入に失敗: ${err.message ?? err}`)
        btn.disabled = false
        btn.textContent = '導入'
      }
    })
    card.appendChild(btn)
    box.appendChild(card)
  }
}

async function runShaderSearch() {
  const query = $('shader-query').value.trim()
  setText('shader-status', 'シェーダーを検索中...')
  try {
    const hits = await window.rLauncher.shaderSearch(query)
    renderShaderResults(hits)
    $('shader-results').dataset.loaded = '1'
    setText('shader-status', query ? `${hits.length}件見つかりました。` : `人気シェーダー ${hits.length}件を表示中。`)
  } catch (err) {
    setText('shader-status', `検索に失敗: ${err.message ?? err}`)
  }
}
$('btn-shader-search').addEventListener('click', runShaderSearch)
$('shader-query').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runShaderSearch()
})

// ===== 起動時 =====
async function init() {
  const state = await window.rLauncher.getSetupState()
  if (!state.setupCompleted) {
    await showSetupScreen()
    return
  }
  await goToLoggedInOrLogin()
}

init()
