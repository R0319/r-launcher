import { describe, expect, it, vi } from 'vitest'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { LauncherService } from './service'
import type { Features } from './features'
import { register, routes, userMessage, type RouteDeps } from './ipcRoutes'
import { z } from 'zod'

function fixture() {
  const called = vi.fn()
  // 不正な入力が本体の操作に到達しないことだけを確認する。
  const service = new Proxy({}, { get: () => called }) as LauncherService
  const features = new Proxy({}, { get: () => called }) as Features
  const deps: RouteDeps = {
    service,
    features,
    play: called,
    login: called,
    installUpdate: called,
    isTrustedSender: vi.fn(() => false),
  }
  return { deps, called }
}
const channels = [
  'app:state',
  'app:save-settings',
  'setup:choose-dir',
  'setup:complete',
  'auth:login',
  'auth:logout',
  'servers:list',
  'servers:ping',
  'servers:detail',
  'servers:optional-mod',
  'servers:retire-extras',
  'play:start',
  'play:anyway',
  'addons:search',
  'addons:install',
  'addons:remove',
  'addons:enable',
  'folders:open',
  'java:check',
  'java:choose',
  'java:check-args',
  'appearance:choose-background',
  'appearance:clear-background',
  'discord:link',
  'discord:unlink',
  'logs:read',
  'logs:copy',
  'logs:save',
  'update:install',
]

describe('IPC', () => {
  it('公開する全チャンネルを検査対象に含める', () =>
    expect(Object.keys(routes(fixture().deps)).sort()).toEqual([...channels].sort()))
  it.each(channels)('%s は信頼できない送信元を拒否する', async (channel) => {
    const { deps, called } = fixture()
    const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
    const ipc = {
      handle: (name, listener) => {
        handlers.set(name, listener)
      },
    } satisfies Pick<IpcMain, 'handle'>
    const log = vi.fn()
    register(ipc as IpcMain, deps, log)
    await expect(handlers.get(channel)!({} as IpcMainInvokeEvent, {})).rejects.toThrow(
      '許可されていない',
    )
    expect(called).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })
  it.each(['servers:ping', 'servers:detail', 'servers:retire-extras', 'play:start', 'play:anyway'])(
    '%s は不正な ID を拒否する',
    (channel) => {
      const { deps, called } = fixture()
      expect(() => routes(deps)[channel]!('../escape')).toThrow()
      expect(called).not.toHaveBeenCalled()
    },
  )
  it.each([
    ['app:save-settings', [{ java: { memoryMaxMb: -1 } }]],
    ['app:save-settings', [{ appearance: { theme: 'unknown' } }]],
    ['app:save-settings', [{ instanceBaseDir: 'C:\\escape' }]],
    ['app:save-settings', [{ java: { path: 'C:\\escape.exe' } }]],
    ['servers:optional-mod', ['../bad', 'project', false]],
    ['servers:optional-mod', ['hub', 'x'.repeat(65), false]],
    ['servers:optional-mod', ['hub', '', false]],
    ['servers:optional-mod', ['hub', 'project', 'yes']],
    ['addons:search', [{ type: 'shader', serverId: '../bad', query: '' }]],
    ['addons:search', [{ type: 'shader', serverId: 'hub', query: 'x'.repeat(101) }]],
    ['addons:search', [{ type: 'shader', serverId: 'hub', query: '', offset: -1 }]],
    ['addons:install', [{ type: 'shader', serverId: 'hub', projectId: '../bad' }]],
    ['addons:remove', [{ type: 'shader', serverId: 'hub', fileName: '../evil.zip' }]],
    ['addons:enable', [{ type: 'shader', serverId: 'hub', fileName: 'evil.jar', enabled: true }]],
    ['addons:enable', [{ type: 'shader', serverId: 'hub', fileName: 'ok.zip', enabled: 'yes' }]],
    ['folders:open', ['hub', '../escape']],
    ['java:check-args', [42]],
  ] satisfies Array<[string, unknown[]]>)('%s が不正な引数 %j を拒否する', (channel, args) => {
    const { deps, called } = fixture()
    expect(() => routes(deps)[channel]!(...args)).toThrow()
    expect(called).not.toHaveBeenCalled()
  })
  it('信頼済みの送信元の操作結果を返す', async () => {
    const { deps, called } = fixture()
    deps.isTrustedSender = () => true
    called.mockResolvedValue({ version: '2.0.0' })
    let handler: ((event: IpcMainInvokeEvent) => unknown) | undefined
    const ipc = {
      handle: (channel, listener) => {
        if (channel === 'app:state') handler = listener
      },
    } satisfies Pick<IpcMain, 'handle'>
    register(ipc as IpcMain, deps, vi.fn())
    await expect(handler!({} as IpcMainInvokeEvent)).resolves.toEqual({ version: '2.0.0' })
  })
  it('例外の複数行とスタックを応答とログから落とす', async () => {
    const { deps, called } = fixture()
    deps.isTrustedSender = () => true
    called.mockRejectedValue(
      new Error('操作に失敗しました\n    at secret (C:\\private\\file.ts:10)'),
    )
    let handler: ((event: IpcMainInvokeEvent) => unknown) | undefined
    const ipc = {
      handle: (channel, listener) => {
        if (channel === 'app:state') handler = listener
      },
    } satisfies Pick<IpcMain, 'handle'>
    const log = vi.fn()
    register(ipc as IpcMain, deps, log)
    await expect(handler!({} as IpcMainInvokeEvent)).rejects.toThrow(/^操作に失敗しました$/)
    expect(log).toHaveBeenCalledWith('[app:state] 操作に失敗しました')
  })
  it('Zod の内部情報と文字列例外を汎用の文にする', () => {
    const parsed = z.string().safeParse(42)
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(userMessage(parsed.error)).toBe('入力の形が正しくありません')
    expect(userMessage('private detail')).toBe('予期しないエラーが起きました')
    expect(userMessage(new Error('x'.repeat(400)))).toHaveLength(300)
  })
})
