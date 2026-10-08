import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Account } from 'eml-lib'
import type { Http } from './http'
import { createHttp, DOWNLOAD_HOSTS } from './http'
import { Addons, inside } from './addons'
import { PanelClient, normalizePanelUrl } from './panel'
import { LauncherManifestSchema, PackSummarySchema, type ManifestMod } from '../shared/contract'
import { defaultSettings } from '../shared/settings'
import { Store } from './store'
import { LogBuffer } from './logs'
import { LauncherService, shaderConfigOf, type Platform } from './service'
import { Features } from './features'
import { linkDiscord, isDiscordAuthorizeUrl } from './discordLink'
import { play, isGameRunning } from './play'
import { sha1, sha512 } from './hash'
import type { LaunchInput } from './launch'

let dir: string
let service: LauncherService
let payload: unknown
let bytes: Buffer
let http: Http
const account: Account = {
  name: 'Steve',
  uuid: '00000000-0000-0000-0000-000000000001',
  accessToken: 'minecraft-secret',
  clientToken: 'client-secret',
  meta: { type: 'msa', online: true },
}
const pack = PackSummarySchema.parse({
  id: 'hub',
  name: 'Hub',
  mcVersion: '1.21.1',
  loader: 'fabric',
  host: 'example.test',
  state: 'running',
})
function manifest(mods: ManifestMod[] = []) {
  return LauncherManifestSchema.parse({
    formatVersion: 1,
    id: 'hub',
    name: 'Hub',
    revision: '1',
    mcVersion: '1.21.1',
    loader: 'fabric',
    loaderVersion: '0.16.0',
    server: { host: 'example.test', port: 25565 },
    integrity: { mode: 'warn', allowExtraMods: false, allowedExtraPatterns: [] },
    mods,
  })
}
function mod(side: 'required' | 'optional' = 'required', slug = 'example'): ManifestMod {
  return {
    source: 'modrinth',
    projectId: slug,
    slug,
    title: slug,
    versionNumber: '1',
    fileName: `${slug}.jar`,
    url: 'https://cdn.modrinth.com/example.jar',
    sha1: sha1(bytes),
    sha512: sha512(bytes),
    size: bytes.length,
    side,
  }
}
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'rl-service-'))
  bytes = Buffer.from('test archive')
  payload = manifest()
  http = {
    getJson: vi.fn(async (_url, schema) => schema.parse(payload)),
    postJson: vi.fn(async (_url, _body, schema) => schema.parse(payload)),
    getBytes: vi.fn(async () => bytes),
  }
  const platform: Platform = {
    version: '2.0.0',
    totalMemoryMb: 32768,
    homeDir: 'C:\\Users\\private-user',
    chooseDirectory: vi.fn(async () => dir),
    chooseFile: vi.fn(async () => null),
    copyText: vi.fn(),
    saveText: vi.fn(async () => true),
    openPath: vi.fn(async () => {}),
    openExternal: vi.fn(async () => {}),
    trash: vi.fn(async () => {}),
    login: vi.fn(async () => account),
    refresh: vi.fn(async () => account),
    ping: vi.fn(async () => ({
      online: 3,
      max: 40,
      motd: 'test',
      version: '1.21.1',
      protocol: 767,
      latencyMs: 12,
    })),
  }
  const store = new Store(path.join(dir, 'store'), {
    available: () => false,
    encrypt: () => {
      throw new Error('使わない')
    },
    decrypt: () => {
      throw new Error('使わない')
    },
  })
  store.save({
    setupCompleted: true,
    settings: { ...defaultSettings(), instanceBaseDir: dir },
    account,
    discord: { name: 'discord-private' },
  })
  service = new LauncherService({
    store,
    http,
    addons: new Addons(http, platform.trash),
    logs: new LogBuffer(path.join(dir, 'logs')),
    platform,
    backgroundsDir: path.join(dir, 'backgrounds'),
  })
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('panel', () => {
  it.each([
    [' https://example.test/api/ ', 'https://example.test/api'],
    ['http://localhost:3000/', 'http://localhost:3000'],
    ['http://127.0.0.1/', 'http://127.0.0.1'],
  ])('URL %s を正規化する', (raw, expected) => expect(normalizePanelUrl(raw)).toBe(expected))
  it.each([
    'http://example.test',
    'ftp://example.test',
    'https://user:pass@example.test',
    'https://example.test?q=x',
    'https://example.test#fragment',
    'not-url',
  ])('不正な Panel URL %s を拒否する', (raw) => expect(normalizePanelUrl(raw)).toBeNull())
  it('壊れた一覧の一件だけを読み飛ばす', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    payload = [pack, { id: '../bad' }, { ...pack, id: 'second' }]
    expect((await service.panel().listPacks()).map((p) => p.id)).toEqual(['hub', 'second'])
  })
  it('別サーバーのマニフェストを拒否する', async () => {
    payload = { ...manifest(), id: 'other' }
    await expect(service.panel().manifest('hub')).rejects.toThrow('別のサーバー')
  })
})

describe('addons', () => {
  function version(
    hashes: { sha1?: string; sha512?: string },
    filename = 'pack.zip',
    url = 'https://cdn.modrinth.com/pack.zip',
  ) {
    return [
      {
        id: 'version',
        game_versions: ['1.21.1'],
        files: [{ url, filename, primary: true, size: bytes.length, hashes }],
      },
    ]
  }
  it('検索条件をエンコードし、外部アイコンを除外する', async () => {
    payload = {
      hits: [
        {
          project_id: 'project',
          slug: 'pack',
          title: 'Pack',
          icon_url: 'https://evil.test/icon.png',
        },
      ],
    }
    const hits = await service.deps.addons.search('shader', ' light & shade ', '1.21.1', 20)
    expect(hits[0]).toMatchObject({ projectId: 'project', iconUrl: null })
    const call = vi.mocked(http.getJson).mock.calls[0]!
    const url = new URL(call[0])
    expect(url.searchParams.get('query')).toBe('light & shade')
    expect(url.searchParams.get('offset')).toBe('20')
    expect(JSON.parse(url.searchParams.get('facets')!)).toEqual([
      ['project_type:shader'],
      ['versions:1.21.1'],
    ])
  })
  it.each(['sha512', 'sha1'] as const)('%s を検証して配置する', async (algorithm) => {
    payload = version({ [algorithm]: algorithm === 'sha1' ? sha1(bytes) : sha512(bytes) })
    expect(await service.deps.addons.install('resourcepack', 'project', '1.21.1', dir)).toBe(
      'pack.zip',
    )
    expect(readFileSync(path.join(dir, 'resourcepacks/pack.zip'))).toEqual(bytes)
    expect(http.getBytes).toHaveBeenCalledWith('https://cdn.modrinth.com/pack.zip', {
      maxBytes: bytes.length + 1,
      allowedHosts: DOWNLOAD_HOSTS,
    })
  })
  it.each(['sha512', 'sha1'] as const)('%s 不一致では配置しない', async (algorithm) => {
    payload = version({ [algorithm]: '0'.repeat(algorithm === 'sha1' ? 40 : 128) })
    await expect(service.deps.addons.install('shader', 'project', '1.21.1', dir)).rejects.toThrow(
      '壊れています',
    )
    expect(existsSync(path.join(dir, 'shaderpacks'))).toBe(false)
  })
  it.each(['evil.jar', '../pack.zip', 'nested/pack.zip'])(
    '不正な配布ファイル %s をダウンロードしない',
    async (filename) => {
      payload = version({ sha1: sha1(bytes) }, filename)
      await expect(service.deps.addons.install('shader', 'project', '1.21.1', dir)).rejects.toThrow(
        '形式',
      )
      expect(http.getBytes).not.toHaveBeenCalled()
    },
  )
  it('許可ホスト外へのダウンロードは偽 fetch にも到達しない', async () => {
    payload = version({ sha1: sha1(bytes) }, 'pack.zip', 'https://evil.test/pack.zip')
    const fetcher = vi.fn<typeof fetch>()
    const guarded = {
      ...http,
      getBytes: createHttp({ userAgent: 'tests', fetch: fetcher }).getBytes,
    }
    await expect(
      new Addons(guarded, service.deps.platform.trash).install('shader', 'project', '1.21.1', dir),
    ).rejects.toThrow('ホスト')
    expect(fetcher).not.toHaveBeenCalled()
    expect(existsSync(path.join(dir, 'shaderpacks'))).toBe(false)
  })
  it.each(['resourcepack', 'shader'] as const)(
    '%s の設定を書き、有効・無効を一覧に反映する',
    async (type) => {
      const folder = type === 'shader' ? 'shaderpacks' : 'resourcepacks'
      mkdirSync(path.join(dir, folder))
      writeFileSync(path.join(dir, folder, 'pack.zip'), bytes)
      await service.deps.addons.setEnabled(type, dir, 'iris.properties', 'pack.zip', true)
      expect(await service.deps.addons.list(type, dir, 'iris.properties')).toEqual([
        { fileName: 'pack.zip', enabled: true, sizeBytes: bytes.length },
      ])
      expect(
        readFileSync(
          path.join(dir, type === 'shader' ? 'config/iris.properties' : 'options.txt'),
          'utf8',
        ),
      ).toContain(type === 'shader' ? 'shaderPack=pack.zip' : 'file/pack.zip')
      await service.deps.addons.remove(type, dir, 'iris.properties', 'pack.zip')
      expect(service.deps.platform.trash).toHaveBeenCalledWith(
        path.resolve(dir, folder, 'pack.zip'),
      )
      expect((await service.deps.addons.list(type, dir, 'iris.properties'))[0]?.enabled).toBe(false)
    },
  )
  it.each(['../evil.jar', '..\\evil.jar', '/evil.jar', 'C:\\outside\\evil.jar', '../evil.zip'])(
    'inside が外部パス %s を拒否する',
    (name) => expect(() => inside(dir, name)).toThrow(),
  )
})

describe('service と features', () => {
  it('state は秘密を返さず、保存先未設定ならセットアップ未完了になる', () => {
    expect(service.state()).toMatchObject({
      version: '2.0.0',
      setupCompleted: true,
      account: { name: 'Steve', uuid: account.uuid },
      totalMemoryMb: 32768,
    })
    expect(JSON.stringify(service.state())).not.toContain(account.accessToken)
    service.deps.store.update((data) => ({
      ...data,
      settings: { ...data.settings, instanceBaseDir: null },
    }))
    expect(service.state().setupCompleted).toBe(false)
  })
  it('不正な Panel URL を保存せず、appearance/java の部分更新で他の値を保つ', () => {
    const original = service.settings
    expect(() => service.saveSettings({ panelUrl: 'http://evil.test' })).toThrow('https')
    expect(service.settings).toEqual(original)
    service.saveSettings({ appearance: { theme: 'dark' }, java: { jvmArgs: '-XX:+UseZGC' } })
    expect(service.settings.appearance).toEqual({ ...original.appearance, theme: 'dark' })
    expect(service.settings.java).toEqual({ ...original.java, jvmArgs: '-XX:+UseZGC' })
  })
  it('mods フォルダのあるサーバーだけ installed にする', async () => {
    payload = [pack, { ...pack, id: 'other' }]
    mkdirSync(path.join(service.gameDir('hub'), 'mods'), { recursive: true })
    expect((await service.listServers()).map((s) => [s.id, s.installed])).toEqual([
      ['hub', true],
      ['other', false],
    ])
  })
  it('required は外せず、optional の切り替えを保存する', async () => {
    payload = manifest([mod('required'), mod('optional', 'optional')])
    await expect(service.setOptionalMod('hub', 'example', false)).rejects.toThrow('外せません')
    const disabled = await service.setOptionalMod('hub', 'optional', false)
    expect(disabled.mods.find((m) => m.projectId === 'optional')?.enabled).toBe(false)
    expect(service.disabledOptional('hub')).toEqual(new Set(['optional']))
    await service.setOptionalMod('hub', 'optional', true)
    expect(service.disabledOptional('hub').size).toBe(0)
  })
  it('利用者の余分な jar だけを退避し managed を動かさない', async () => {
    const modsDir = path.join(service.gameDir('hub'), 'mods')
    mkdirSync(modsDir, { recursive: true })
    writeFileSync(path.join(modsDir, 'user.jar'), 'user')
    writeFileSync(path.join(modsDir, 'managed.jar'), 'managed')
    writeFileSync(path.join(modsDir, '.r-launcher-managed.json'), JSON.stringify(['managed.jar']))
    await service.retireExtraMods('hub')
    expect(existsSync(path.join(modsDir, 'managed.jar'))).toBe(true)
    expect(existsSync(path.join(modsDir, 'user.jar'))).toBe(false)
    const retired = path.join(service.gameDir('hub'), 'mods-disabled')
    const stamp = readdirSync(retired)[0]!
    expect(readdirSync(path.join(retired, stamp))).toEqual(['user.jar'])
    expect(readFileSync(path.join(retired, stamp, 'user.jar'), 'utf8')).toBe('user')
  })
  it.each([
    ['iris', 'iris.properties'],
    ['oculus', 'oculus.properties'],
    ['example', null],
  ])('ローダー %s の設定を判定する', (slug, expected) =>
    expect(shaderConfigOf(manifest([mod('required', slug)]))).toBe(expected),
  )
  it('コピーするログのアカウント名・Discord 名・ホーム・トークンを伏せる', () => {
    service.deps.logs.write(
      'game',
      `Steve discord-private C:\\Users\\private-user\\game --accessToken minecraft-secret`,
    )
    const result = new Features(service).copyLog()
    const text = vi.mocked(service.deps.platform.copyText).mock.calls[0]![0]
    for (const secret of ['Steve', 'discord-private', 'private-user', 'minecraft-secret'])
      expect(text).not.toContain(secret)
    expect(text).toContain('<token>')
    expect(result.lines).toBe(1)
    expect(result.masked.token).toBeGreaterThan(0)
  })
  it('シェーダーローダーなしではインストールを呼ばない', async () => {
    const install = vi.spyOn(service.deps.addons, 'install')
    await expect(
      new Features(service).installAddon({ type: 'shader', serverId: 'hub', projectId: 'project' }),
    ).rejects.toThrow('Iris / Oculus')
    expect(install).not.toHaveBeenCalled()
    expect(http.getBytes).not.toHaveBeenCalled()
  })
})

describe('discordLink', () => {
  it.each([
    'https://discord.com/oauth2/authorize?client_id=1',
    'https://discordapp.com/api/oauth2/authorize',
  ])('認可 URL %s を許可する', (url) => expect(isDiscordAuthorizeUrl(url)).toBe(true))
  it.each([
    'https://evil.test/oauth2/authorize',
    'http://discord.com/oauth2/authorize',
    'https://discord.com/invite/abc',
    'https://discord.com.evil.test/oauth2/authorize',
  ])('別サイト・http・別パス %s を拒否する', (url) =>
    expect(isDiscordAuthorizeUrl(url)).toBe(false),
  )
  function linkFixture(status: 'linked' | 'expired' = 'linked', joinStatus = 204) {
    const events: string[] = []
    const panelBodies: unknown[] = []
    let polls = 0
    const fakeHttp: Http = {
      ...http,
      postJson: async (url, body, schema) => {
        panelBodies.push(body)
        if (url.endsWith('/start')) {
          events.push('start')
          return schema.parse({ linkId: 'a'.repeat(20), serverId: 'abc', expiresAt: '2099-01-01' })
        }
        events.push('verify')
        return schema.parse({ authorizeUrl: 'https://discord.com/oauth2/authorize?client_id=1' })
      },
      getJson: async (_url, schema) => {
        events.push('status')
        polls++
        return schema.parse(
          polls === 1
            ? { state: 'pending' }
            : status === 'linked'
              ? { state: status, discord: { id: '1', name: 'linked-name' } }
              : { state: status },
        )
      },
    }
    const fetcher = vi.fn<typeof fetch>(async () => {
      events.push('join')
      return new Response(null, { status: joinStatus })
    })
    const openExternal = vi.fn(async () => {
      events.push('open')
    })
    return {
      events,
      panelBodies,
      fetcher,
      openExternal,
      deps: {
        panel: new PanelClient(fakeHttp, 'https://panel.test'),
        fetch: fetcher,
        openExternal,
        sleep: async () => {
          events.push('wait')
        },
      },
    }
  }
  it('start → Mojang join → verify → ブラウザ → pending → linked を実行し Panel にトークンを渡さない', async () => {
    const f = linkFixture()
    expect(await linkDiscord(f.deps, account)).toEqual({ name: 'linked-name' })
    expect(f.events).toEqual([
      'start',
      'join',
      'verify',
      'open',
      'wait',
      'status',
      'wait',
      'status',
    ])
    expect(JSON.stringify(f.panelBodies)).not.toContain(account.accessToken)
    expect(f.panelBodies).toEqual([{}, { linkId: 'a'.repeat(20), username: 'Steve' }])
    const [url, init] = f.fetcher.mock.calls[0]!
    expect(url).toBe('https://sessionserver.mojang.com/session/minecraft/join')
    expect(JSON.parse(String(init?.body))).toEqual({
      accessToken: account.accessToken,
      selectedProfile: account.uuid.replace(/-/g, ''),
      serverId: 'abc',
    })
  })
  it('join 失敗で verify とブラウザを呼ばない', async () => {
    const f = linkFixture('linked', 403)
    await expect(linkDiscord(f.deps, account)).rejects.toThrow('アカウントの確認')
    expect(f.events).toEqual(['start', 'join'])
    expect(f.openExternal).not.toHaveBeenCalled()
  })
  it('Panel の期限切れをエラーにする', async () => {
    const f = linkFixture('expired')
    await expect(linkDiscord(f.deps, account)).rejects.toThrow('時間内')
  })
  it('待機の上限を超えたら status を呼ばず終了する', async () => {
    const f = linkFixture()
    await expect(linkDiscord({ ...f.deps, timeoutMs: 0 }, account)).rejects.toThrow('時間内')
    expect(f.events).not.toContain('status')
  })
})

describe('play', () => {
  function deps(
    launch = vi.fn<(input: LaunchInput) => Promise<void>>(async (input) => {
      input.onPhase({ phase: 'launching' })
    }),
  ) {
    return { service, launch, onPhase: vi.fn(), onRunning: vi.fn(), onExit: vi.fn() }
  }
  it('Mod のハッシュ照合と同期を終えてからゲームを起動する', async () => {
    payload = manifest([mod()])
    const f = deps(
      vi.fn(async (input) => {
        expect(readFileSync(path.join(service.gameDir('hub'), 'mods/example.jar'))).toEqual(bytes)
        input.onPhase({ phase: 'launching' })
      }),
    )
    expect(await play(f, 'hub', false)).toEqual({ ok: true })
    expect(f.launch).toHaveBeenCalledOnce()
    expect(f.onPhase.mock.calls.map(([p]) => p.phase)).toEqual([
      'manifest',
      'mods',
      'mods',
      'check',
      'launching',
    ])
  })
  it.each([
    ['warn', false, false],
    ['warn', true, true],
    ['block', false, false],
    ['block', true, false],
  ] as const)('%s force=%s の起動可否を守る', async (mode, force, allowed) => {
    payload = {
      ...manifest(),
      integrity: { mode, allowExtraMods: false, allowedExtraPatterns: [] },
    }
    const modsDir = path.join(service.gameDir('hub'), 'mods')
    mkdirSync(modsDir, { recursive: true })
    writeFileSync(path.join(modsDir, 'extra.jar'), 'extra')
    const f = deps()
    const result = await play(f, 'hub', force)
    expect(result.ok).toBe(allowed)
    expect(f.launch).toHaveBeenCalledTimes(allowed ? 1 : 0)
    if (!allowed)
      expect(result).toMatchObject({ reason: 'integrity', integrity: { verdict: mode } })
  })
  it.each([
    { jvmArgs: '-Xmx4G' },
    { memoryMinMb: 8192, memoryMaxMb: 4096 },
    { memoryMaxMb: 32768 },
  ])('不正な JVM/メモリ %j では通信も起動もしない', async (patch) => {
    service.saveSettings({ java: patch })
    const f = deps()
    expect(await play(f, 'hub', false)).toMatchObject({ ok: false, reason: 'error' })
    expect(f.launch).not.toHaveBeenCalled()
    expect(http.getJson).not.toHaveBeenCalled()
  })
  it('実行中の二重起動を拒否し、終了後に状態を戻す', async () => {
    let finish: (() => void) | undefined
    const f = deps(
      vi.fn(
        (input) =>
          new Promise<void>((resolve) => {
            finish = resolve
            input.onPhase({ phase: 'running' })
          }),
      ),
    )
    expect(await play(f, 'hub', false)).toEqual({ ok: true })
    expect(isGameRunning()).toBe(true)
    expect(await play(f, 'hub', false)).toMatchObject({
      ok: false,
      reason: 'error',
      message: 'すでにゲームが起動しています',
    })
    expect(f.launch).toHaveBeenCalledOnce()
    finish!()
    await Promise.resolve()
    expect(isGameRunning()).toBe(false)
  })
  it('起動前に終了したらエラーにし、再試行を可能にする', async () => {
    const f = deps(vi.fn(async () => {}))
    expect(await play(f, 'hub', false)).toMatchObject({
      ok: false,
      reason: 'error',
      message: 'ゲームが起動前に終了しました',
    })
    expect(isGameRunning()).toBe(false)
    expect(f.onExit).toHaveBeenCalledOnce()
  })
})
