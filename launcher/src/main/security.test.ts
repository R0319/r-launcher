import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Account } from 'eml-lib'
import { Store, type Cipher } from './store'
import { defaultSettings } from '../shared/settings'
import {
  imageType,
  importBackground,
  MAX_BACKGROUND_BYTES,
  resolveBackgroundRequest,
} from './background'
import { emlConfig, stripSecrets } from './launch'
import { LogBuffer } from './logs'
import { LauncherManifestSchema } from '../shared/contract'

const dirs: string[] = []
function temp() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'rl-tests-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true }))
  dirs.length = 0
  vi.restoreAllMocks()
})
const account: Account = {
  name: 'Steve',
  uuid: '1234',
  accessToken: 'secret-access',
  refreshToken: 'secret-refresh',
  clientToken: 'secret-client',
  meta: { online: true, type: 'msa' },
}
const cipher: Cipher = {
  available: () => true,
  encrypt: (s) => Buffer.from(s).toString('base64'),
  decrypt: (s) => Buffer.from(s, 'base64').toString(),
}

describe('store', () => {
  it('暗号化したトークンだけを書き、新しい Store でも復号する', () => {
    const dir = temp()
    const store = new Store(dir, cipher)
    const data = {
      setupCompleted: true,
      settings: defaultSettings(),
      account,
      discord: { name: 'discord-user' },
    }
    store.save(data)
    const raw = readFileSync(path.join(dir, 'store.json'), 'utf8')
    for (const token of [account.accessToken, account.refreshToken!, account.clientToken])
      expect(raw).not.toContain(token)
    expect(raw).toContain('enc:')
    expect(new Store(dir, cipher).load()).toEqual(data)
  })
  it('暗号化できなければメモリだけで保持し、再起動で捨てる', () => {
    const dir = temp()
    const unavailable = { ...cipher, available: () => false }
    const store = new Store(dir, unavailable)
    store.save({ ...store.load(), account })
    expect(store.load().account).toEqual(account)
    expect(JSON.parse(readFileSync(path.join(dir, 'store.json'), 'utf8')).account).toBeNull()
    expect(new Store(dir, unavailable).load().account).toBeNull()
  })
  it('v1 の保存先・メモリ・Discord 名を引き継ぎ、平文アカウントは捨てる', () => {
    const dir = temp()
    writeFileSync(
      path.join(dir, 'store.json'),
      JSON.stringify({
        setupCompleted: true,
        settings: { instanceBaseDir: 'C:\\Games', memoryMinMb: 2048, memoryMaxMb: 8192 },
        discordName: 'old-discord',
        account,
      }),
    )
    // 本物の safeStorage と同じく、暗号化していない値の復号は失敗する
    const strict: Cipher = {
      available: () => true,
      encrypt: (v) => `v1enc-${v}`,
      decrypt: (v) => {
        if (!v.startsWith('v1enc-')) throw new Error('not encrypted')
        return v.slice(6)
      },
    }
    const data = new Store(dir, strict).load()
    expect(data).toMatchObject({
      setupCompleted: true,
      settings: { instanceBaseDir: 'C:\\Games', java: { memoryMinMb: 2048, memoryMaxMb: 8192 } },
      discord: { name: 'old-discord' },
      account: null,
    })
    // v1 が暗号化して保存したアカウントは引き継ぐ（更新後にログインし直さなくてよい）
    writeFileSync(
      path.join(dir, 'store.json'),
      JSON.stringify({
        setupCompleted: true,
        account: {
          ...account,
          accessToken: 'v1enc-secret-access',
          refreshToken: 'v1enc-secret-refresh',
          clientToken: 'v1enc-secret-client',
        },
      }),
    )
    expect(new Store(dir, strict).load().account).toEqual(account)
    expect(new Store(dir, { ...strict, available: () => false }).load().account).toBeNull()
  })
  it.each(['{broken', 'null', '[]'])('壊れた保存データ %s は初期値で続ける', (raw) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const dir = temp()
    writeFileSync(path.join(dir, 'store.json'), raw)
    expect(new Store(dir, cipher).load()).toEqual({
      setupCompleted: false,
      settings: defaultSettings(),
      account: null,
      discord: null,
    })
  })
  it('v2 の平文トークンと復号失敗を拒否する', () => {
    const dir = temp()
    const store = new Store(dir, cipher)
    writeFileSync(path.join(dir, 'store.json'), JSON.stringify({ version: 2, account }))
    expect(store.load().account).toBeNull()
    store.save({ ...store.load(), account })
    expect(
      new Store(dir, {
        ...cipher,
        decrypt: () => {
          throw new Error('復号失敗')
        },
      }).load().account,
    ).toBeNull()
  })
})

describe('background', () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  it.each([
    [png, 'png'],
    [Buffer.from([255, 216, 255]), 'jpg'],
    [Buffer.from('RIFF0000WEBP'), 'webp'],
    [Buffer.from('GIF89a'), null],
    [Buffer.from('<svg/>'), null],
    [Buffer.alloc(0), null],
  ] as const)('先頭バイトで形式を判定する %s', (bytes, type) => expect(imageType(bytes)).toBe(type))
  it('偽の png 拡張子を拒否し、実際の形式で保存する', () => {
    const dir = temp()
    const source = path.join(dir, 'fake.png')
    const target = path.join(dir, 'images')
    writeFileSync(source, 'not an image')
    expect(() => importBackground(source, target)).toThrow('PNG')
    expect(existsSync(target)).toBe(false)
    writeFileSync(source, Buffer.from([255, 216, 255]))
    const name = importBackground(source, target)
    expect(name).toMatch(/^[a-f0-9]{64}\.jpg$/)
    expect(readFileSync(path.join(target, name))).toEqual(Buffer.from([255, 216, 255]))
  })
  it('10MB 超を拒否する', () => {
    const dir = temp()
    const source = path.join(dir, 'large.png')
    writeFileSync(source, Buffer.concat([png, Buffer.alloc(MAX_BACKGROUND_BYTES + 1 - png.length)]))
    expect(() => importBackground(source, path.join(dir, 'images'))).toThrow('10MB')
  })
  const name = `${'a'.repeat(64)}.png`
  it('正しい背景要求だけを解決する', () =>
    expect(resolveBackgroundRequest(`rl-bg://image/${name}`, temp())).toMatch(
      new RegExp(`${name}$`),
    ))
  it.each([
    'rl-bg://image/../bad.png',
    'rl-bg://other/' + name,
    'https://image/' + name,
    'rl-bg://image/not-hash.png',
    'rl-bg://image/%ZZ',
    'rl-bg://image/%2e%2e%2f' + name,
    'rl-bg://image/../' + name,
  ])('不正な背景 URL %s を拒否する', (url) =>
    expect(resolveBackgroundRequest(url, temp())).toBeNull(),
  )
})

describe('launch', () => {
  it.each([
    '--accessToken secret',
    '--clientId secret',
    '--xuid secret',
    'eyJabcdefgh.abcdefgh.abcdefgh',
  ])('秘密をログから除く %s', (text) => {
    expect(stripSecrets(text)).toContain('<hidden>')
    expect(stripSecrets(text)).not.toContain('secret')
    expect(stripSecrets(text)).not.toContain('eyJ')
  })
  it.each(['auto', 'manual'] as const)('Java %s と掃除無効・メモリ範囲を設定する', (mode) => {
    const manifest = LauncherManifestSchema.parse({
      formatVersion: 1,
      id: 'hub',
      name: 'Hub',
      revision: '1',
      mcVersion: '1.21.1',
      loader: 'fabric',
      loaderVersion: '0.16.0',
      server: { host: 'example.test', port: 25565 },
      integrity: { mode: 'warn', allowExtraMods: false, allowedExtraPatterns: [] },
      mods: [],
    })
    const config = emlConfig({
      account,
      manifest,
      instanceBaseDir: temp(),
      jvmArgs: ['-XX:+UseZGC'],
      java: {
        ...defaultSettings().java,
        mode,
        path: 'C:\\Java\\java.exe',
        memoryMinMb: 8192,
        memoryMaxMb: 4096,
      },
    })
    expect(config.cleaning.enabled).toBe(false)
    expect(config.memory).toEqual({ min: 4096, max: 4096 })
    expect(config.java).toEqual(
      mode === 'manual'
        ? { install: 'manual', absolutePath: 'C:\\Java\\java.exe', args: ['-XX:+UseZGC'] }
        : { install: 'auto', args: ['-XX:+UseZGC'] },
    )
  })
})

describe('logs', () => {
  it('5000 行に制限し、空行を飛ばす', () => {
    const logs = new LogBuffer(temp())
    logs.write('game', Array.from({ length: 5002 }, (_, i) => `line-${i}`).join('\n') + '\n\n')
    const lines = logs.text().split('\n')
    expect(lines).toHaveLength(5000)
    expect(lines[0]).toContain('line-2')
    expect(lines.at(-1)).toContain('line-5001')
  })
  it('previous.log を置き換えて二世代だけ保存する', () => {
    const dir = temp()
    new LogBuffer(dir).write('launcher', 'first')
    new LogBuffer(dir).write('game', 'second')
    new LogBuffer(dir).write('game', 'third')
    expect(readFileSync(path.join(dir, 'previous.log'), 'utf8')).toContain('second')
    expect(readFileSync(path.join(dir, 'previous.log'), 'utf8')).not.toContain('first')
    expect(readFileSync(path.join(dir, 'latest.log'), 'utf8')).toContain('third')
  })
  it('購読と解除を行う', () => {
    const logs = new LogBuffer(temp())
    const listener = vi.fn()
    const off = logs.onLine(listener)
    logs.write('game', 'first\nsecond')
    expect(listener).toHaveBeenCalledTimes(2)
    off()
    logs.write('game', 'third')
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe('静的セキュリティ', () => {
  it('CSP が画面の通信・外部スクリプト・オブジェクトを制限する', () => {
    const html = readFileSync(path.join(process.cwd(), 'src/renderer/index.html'), 'utf8')
    const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1]
    expect(csp).toBeDefined()
    for (const directive of ["connect-src 'none'", "script-src 'self'", "object-src 'none'"])
      expect(csp).toContain(directive)
    expect(csp).not.toContain('unsafe-eval')
  })
  it('BrowserWindow を隔離し、新規ウィンドウを拒否する', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/main/index.ts'), 'utf8')
    for (const option of ['contextIsolation: true', 'nodeIntegration: false', 'sandbox: true'])
      expect(source).toContain(option)
    expect(source).toMatch(/setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/)
  })
})

describe('panelProblem', () => {
  it('tells the user what to check, with the panel host', async () => {
    const { panelProblem } = await import('./service')
    const url = 'https://panel.example.jp'
    expect(panelProblem(new Error('通信に失敗しました'), url)).toBe(
      'Panel（panel.example.jp）につながりません。インターネット接続と、設定の「Panel の URL」を確かめてください',
    )
    expect(panelProblem(Object.assign(new Error('x'), { status: 404 }), url)).toContain(
      '一覧がありません',
    )
    expect(panelProblem(Object.assign(new Error('x'), { status: 503 }), url)).toContain(
      'しばらくしてから',
    )
    expect(panelProblem(new Error('応答の形が想定と違います'), url)).toContain('最新版に更新')
  })
})
