// 画面だけを確かめるための偽の本体（Electron なしで `npm run dev:renderer` したときと、画面のテストで使う）。
import type {
  AddonHit,
  AppState,
  PlayPhase,
  RLauncherApi,
  ServerDetail,
  ServerView,
  UpdateStatus,
} from '../shared/ipc'
import { defaultSettings } from '../shared/settings'

type Listener<T> = (value: T) => void

export interface MockOptions {
  setupCompleted?: boolean
  loggedIn?: boolean
  integrity?: 'ok' | 'warn' | 'block'
  playDelayMs?: number
}

export function createMockApi(options: MockOptions = {}): RLauncherApi & {
  emitLog(line: string): void
  emitPhase(phase: PlayPhase): void
  calls: string[]
} {
  const calls: string[] = []
  const logListeners = new Set<Listener<string>>()
  const phaseListeners = new Set<Listener<PlayPhase>>()
  const updateListeners = new Set<Listener<UpdateStatus>>()
  const logs: string[] = [
    '[21:04:10] [launcher] R-Launcher 2.0.0 を起動しました',
    '[21:04:12] [game] [main/INFO]: Loading Minecraft 1.21.1 with NeoForge 21.1.77',
    '[21:04:15] [game] [main/WARN]: Missing sound for event: minecraft:item.goat_horn.play',
  ]
  let state: AppState = {
    version: '2.0.0',
    setupCompleted: options.setupCompleted ?? true,
    settings: { ...defaultSettings(), instanceBaseDir: 'C:\\Games' },
    account:
      options.loggedIn === false
        ? null
        : { name: 'Steve', uuid: '00000000-0000-0000-0000-000000000001' },
    discord: null,
    totalMemoryMb: 32768,
    backgroundUrl: null,
  }
  const servers: ServerView[] = [
    {
      id: 'hub',
      name: 'ハブ',
      mcVersion: '1.21.1',
      loader: 'neoforge',
      host: 'play.mc-shouchan.jp',
      port: 25565,
      state: 'running',
      online: { players: 4, max: 40 },
      installed: true,
    },
    {
      id: 'create',
      name: 'Create 工業',
      mcVersion: '1.21.1',
      loader: 'neoforge',
      host: 'create.mc-shouchan.jp',
      port: 25565,
      state: 'running',
      online: { players: 2, max: 20 },
      installed: false,
    },
    {
      id: 'pvp',
      name: '銃 PvP',
      mcVersion: '1.21.1',
      loader: 'neoforge',
      host: 'pvp.mc-shouchan.jp',
      port: 25565,
      state: 'stopped',
      online: null,
      installed: true,
    },
  ]
  const integrity =
    options.integrity && options.integrity !== 'ok'
      ? {
          verdict: options.integrity,
          missing: [],
          mismatched: [],
          extras: [{ fileName: 'xray-ultimate.jar', allowed: false }],
        }
      : null
  const details: Record<string, ServerDetail> = {}
  const detailOf = (id: string): ServerDetail => {
    details[id] ??= {
      id,
      name: servers.find((s) => s.id === id)?.name ?? id,
      mcVersion: '1.21.1',
      loader: 'neoforge',
      loaderVersion: '21.1.77',
      revision: '12',
      policy: {
        mode: options.integrity === 'block' ? 'block' : 'warn',
        allowExtraMods: false,
        allowedExtraPatterns: ['sodium'],
      },
      mods: [
        {
          projectId: 'tacz',
          title: 'Timeless and Classics Zero',
          versionNumber: '1.1.4',
          fileName: 'tacz-1.1.4.jar',
          side: 'required',
          enabled: true,
        },
        {
          projectId: 'cordite',
          title: 'Cordite',
          versionNumber: '0.9.2',
          fileName: 'cordite-0.9.2.jar',
          side: 'required',
          enabled: true,
        },
        {
          projectId: 'jei',
          title: 'Just Enough Items',
          versionNumber: '19.21.0',
          fileName: 'jei-19.21.0.jar',
          side: 'required',
          enabled: true,
        },
        {
          projectId: 'oculus',
          title: 'Oculus',
          versionNumber: '1.8.0',
          fileName: 'oculus-1.8.0.jar',
          side: 'optional',
          enabled: true,
        },
        {
          projectId: 'minimap',
          title: "Xaero's Minimap",
          versionNumber: '25.2.0',
          fileName: 'xaerominimap.jar',
          side: 'optional',
          enabled: false,
        },
      ],
      serverOnly: ['Spark', 'LuckPerms', 'Chunky'],
      integrity,
      resourcepacks: [
        { fileName: 'FreshAnimations_v1.9.zip', enabled: true, sizeBytes: 2_400_000 },
      ],
      shaders: [],
      shaderLoader: true,
    }
    return details[id]!
  }
  const hits: AddonHit[] = [
    {
      projectId: 'compl',
      slug: 'complementary-reimagined',
      title: 'Complementary Shaders - Reimagined',
      description: 'Minecraft の雰囲気を残したまま、光と影を足すシェーダー',
      author: 'EminGT',
      downloads: 9_400_000,
      iconUrl: null,
    },
    {
      projectId: 'bsl',
      slug: 'bsl-shaders',
      title: 'BSL Shaders',
      description: '明るく軽いシェーダー',
      author: 'capttatsu',
      downloads: 6_100_000,
      iconUrl: null,
    },
  ]
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const track = <T>(name: string, value: T): Promise<T> => {
    calls.push(name)
    return Promise.resolve(value)
  }

  return {
    calls,
    emitLog: (line) => logListeners.forEach((l) => l(line)),
    emitPhase: (phase) => phaseListeners.forEach((l) => l(phase)),
    getState: () => track('getState', state),
    saveSettings: async (patch) => {
      calls.push(`saveSettings:${JSON.stringify(patch)}`)
      state = {
        ...state,
        settings: {
          ...state.settings,
          ...patch,
          appearance: { ...state.settings.appearance, ...patch.appearance },
          java: { ...state.settings.java, ...patch.java },
        },
      }
      return state
    },
    chooseInstanceDir: () => track('chooseInstanceDir', 'C:\\Games'),
    completeSetup: async () => {
      state = { ...state, setupCompleted: true }
      return track('completeSetup', state)
    },
    loginMicrosoft: async () => {
      state = { ...state, account: { name: 'Steve', uuid: 'x' } }
      return track('loginMicrosoft', state)
    },
    logout: async () => {
      state = { ...state, account: null }
      return track('logout', state)
    },
    listServers: () => track('listServers', servers),
    pingServer: (id) =>
      track(`ping:${id}`, {
        online: 4,
        max: 40,
        motd: 'mc-shouchan ハブ\n参加型サーバー',
        version: 'NeoForge 1.21.1',
        latencyMs: 18,
      }),
    serverDetail: (id) => track(`detail:${id}`, detailOf(id)),
    setOptionalMod: async (id, projectId, enabled) => {
      calls.push(`optional:${projectId}:${enabled}`)
      const detail = detailOf(id)
      details[id] = {
        ...detail,
        mods: detail.mods.map((m) => (m.projectId === projectId ? { ...m, enabled } : m)),
      }
      return details[id]!
    },
    retireExtraMods: async (id) => {
      calls.push(`retire:${id}`)
      details[id] = { ...detailOf(id), integrity: null }
      return details[id]!
    },
    play: async (id) => {
      calls.push(`play:${id}`)
      if (integrity) return { ok: false, reason: 'integrity', integrity }
      phaseListeners.forEach((l) =>
        l({ phase: 'mods', done: 1, total: 3, fileName: 'tacz-1.1.4.jar' }),
      )
      await wait(options.playDelayMs ?? 0)
      phaseListeners.forEach((l) => l({ phase: 'running' }))
      return { ok: true }
    },
    playAnyway: async (id) => {
      calls.push(`playAnyway:${id}`)
      return { ok: true }
    },
    searchAddons: async (input) => {
      calls.push(`search:${input.type}:${input.query}`)
      return hits.filter((h) => h.title.toLowerCase().includes(input.query.toLowerCase()))
    },
    installAddon: async (input) => {
      calls.push(`install:${input.projectId}`)
      const detail = detailOf(input.serverId)
      details[input.serverId] = {
        ...detail,
        [input.type === 'shader' ? 'shaders' : 'resourcepacks']: [
          ...(input.type === 'shader' ? detail.shaders : detail.resourcepacks),
          { fileName: `${input.projectId}.zip`, enabled: true, sizeBytes: 300_000 },
        ],
      }
      return details[input.serverId]!
    },
    removeAddon: async (input) => {
      calls.push(`remove:${input.fileName}`)
      const detail = detailOf(input.serverId)
      details[input.serverId] = {
        ...detail,
        resourcepacks: detail.resourcepacks.filter((p) => p.fileName !== input.fileName),
        shaders: detail.shaders.filter((p) => p.fileName !== input.fileName),
      }
      return details[input.serverId]!
    },
    setAddonEnabled: async (input) => {
      calls.push(`enable:${input.fileName}:${input.enabled}`)
      const detail = detailOf(input.serverId)
      const flip = (list: ServerDetail['shaders']) =>
        list.map((p) => (p.fileName === input.fileName ? { ...p, enabled: input.enabled } : p))
      details[input.serverId] = {
        ...detail,
        resourcepacks: flip(detail.resourcepacks),
        shaders: flip(detail.shaders),
      }
      return details[input.serverId]!
    },
    openFolder: async (id, folder) => {
      calls.push(`open:${id}:${folder}`)
    },
    checkJava: () =>
      track('checkJava', {
        mode: state.settings.java.mode,
        path: state.settings.java.path,
        detectedVersion: null,
      }),
    chooseJava: () =>
      track('chooseJava', {
        mode: 'manual' as const,
        path: 'C:\\Java\\bin\\javaw.exe',
        detectedVersion: '21.0.4',
      }),
    checkJvmArgs: async (text) => {
      calls.push(`checkArgs:${text}`)
      return /-Xmx/i.test(text)
        ? { ok: false, error: '-Xmx は使えません（メモリは設定欄で決めます）' }
        : { ok: true }
    },
    chooseBackground: () => track('chooseBackground', state),
    clearBackground: () => track('clearBackground', state),
    linkDiscord: async () => {
      state = { ...state, discord: { name: 'steve_jp' } }
      return track('linkDiscord', state)
    },
    unlinkDiscord: async () => {
      state = { ...state, discord: null }
      return track('unlinkDiscord', state)
    },
    readLog: () => track('readLog', logs.join('\n')),
    copyLog: () =>
      track('copyLog', {
        lines: 3,
        masked: { token: 1, uuid: 2, player: 1, path: 0, ip: 0, email: 0, discord: 0 },
      }),
    saveLog: () =>
      track('saveLog', {
        lines: 3,
        masked: { token: 0, uuid: 0, player: 0, path: 0, ip: 0, email: 0, discord: 0 },
      }),
    installUpdate: () => track('installUpdate', undefined),
    onPlayProgress: (cb) => {
      phaseListeners.add(cb)
      return () => phaseListeners.delete(cb)
    },
    onLogLine: (cb) => {
      logListeners.add(cb)
      return () => logListeners.delete(cb)
    },
    onUpdateStatus: (cb) => {
      updateListeners.add(cb)
      return () => updateListeners.delete(cb)
    },
  }
}
