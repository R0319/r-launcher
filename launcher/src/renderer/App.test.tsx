// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { App } from './App'
import { createMockApi, type MockOptions } from './mockApi'
import { setApi } from './api'
import type { AddonType, PlayResult } from '../shared/ipc'

afterEach(() => {
  cleanup()
  setApi(undefined)
  vi.restoreAllMocks()
  delete document.documentElement.dataset.theme
  delete document.documentElement.dataset.accent
})
async function start(options: MockOptions = {}) {
  const mock = createMockApi(options)
  setApi(mock)
  render(<App />)
  await screen.findByRole('heading', { name: 'ハブ' })
  await screen.findByRole('heading', { name: '任意' })
  return mock
}
function button(name: string | RegExp) {
  return screen.getByRole('button', { name })
}

describe('画面', () => {
  it('保存先を選ぶまで始めるを押せず、選択後に初回設定を終えられる', async () => {
    const mock = createMockApi({ setupCompleted: false, loggedIn: false })
    const state = await mock.getState()
    state.settings.instanceBaseDir = null
    mock.chooseInstanceDir = vi.fn(async () => {
      state.settings.instanceBaseDir = 'C:\\Games'
      return 'C:\\Games'
    })
    setApi(mock)
    render(<App />)
    await screen.findByRole('heading', { name: 'R-Launcher を使う準備' })
    expect((button('始める') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(button('選ぶ'))
    await waitFor(() => expect((button('始める') as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(button('始める'))
    await screen.findByRole('heading', { name: 'ハブ' })
    expect(mock.calls).toContain('completeSetup')
  })
  it('サーバー一覧・稼働状態・人数・遅延を表示して選択を保存する', async () => {
    const mock = await start()
    expect(screen.getAllByText('稼働中').length).toBeGreaterThan(0)
    expect(await screen.findByText('4 / 40 人')).toBeTruthy()
    expect(screen.getByText('18 ms')).toBeTruthy()
    fireEvent.click(button(/Create 工業/))
    await screen.findByRole('heading', { name: 'Create 工業' })
    expect(mock.calls).toContain('saveSettings:{"selectedServerId":"create"}')
    expect(mock.calls).toContain('detail:create')
    fireEvent.click(button(/銃 PvP/))
    await screen.findByRole('heading', { name: '銃 PvP' })
    expect((button('サーバー停止中') as HTMLButtonElement).disabled).toBe(true)
  })
  it('必須・任意・サーバーのみを表示し、任意だけ切り替える', async () => {
    const mock = await start()
    expect(screen.getByRole('heading', { name: '必須' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'サーバーのみ' })).toBeTruthy()
    expect(screen.getByText('Spark、LuckPerms、Chunky')).toBeTruthy()
    expect(screen.queryByRole('checkbox', { name: /Timeless/ })).toBeNull()
    const toggle = screen.getByRole('checkbox', { name: 'Oculus を入れる' }) as HTMLInputElement
    expect(toggle.checked).toBe(true)
    fireEvent.click(toggle)
    await waitFor(() => expect(toggle.checked).toBe(false))
    expect(mock.calls).toContain('optional:oculus:false')
    fireEvent.click(toggle)
    await waitFor(() => expect(toggle.checked).toBe(true))
  })
  it.each(['shader', 'resourcepack'] as const)(
    '%s タブで検索・インストール・有効切替・削除を操作する',
    async (type: AddonType) => {
      const mock = await start()
      const install = vi.spyOn(mock, 'installAddon')
      fireEvent.click(
        screen.getByRole('tab', { name: type === 'shader' ? /シェーダー/ : /リソースパック/ }),
      )
      fireEvent.change(
        screen.getByRole('textbox', {
          name: type === 'shader' ? 'シェーダーの検索' : 'リソースパックの検索',
        }),
        { target: { value: 'Complementary' } },
      )
      fireEvent.click(button('検索'))
      await screen.findByText('Complementary Shaders - Reimagined')
      expect(mock.calls).toContain(`search:${type}:Complementary`)
      fireEvent.click(button('入れる'))
      await screen.findByText('compl.zip')
      expect(install).toHaveBeenCalledWith({ type, serverId: 'hub', projectId: 'compl' })
      fireEvent.click(screen.getByRole('checkbox', { name: 'compl.zip を使う' }))
      await waitFor(() => expect(mock.calls).toContain('enable:compl.zip:false'))
      await waitFor(() =>
        expect(
          (screen.getByRole('checkbox', { name: 'compl.zip を使う' }) as HTMLInputElement).disabled,
        ).toBe(false),
      )
      await waitFor(() =>
        expect(
          (screen.getByRole('checkbox', { name: 'compl.zip を使う' }) as HTMLInputElement).checked,
        ).toBe(false),
      )
      const row = screen.getByText('compl.zip').closest('li')!
      fireEvent.click(within(row).getByRole('button', { name: '外す' }))
      await waitFor(() => expect(screen.queryByText('compl.zip')).toBeNull())
      expect(mock.calls).toContain('remove:compl.zip')
    },
  )
  it('Mod とゲーム本体の進捗を表示し、起動後は二重起動を無効にする', async () => {
    const mock = await start()
    let finish: (() => void) | undefined
    mock.play = vi.fn(
      () =>
        new Promise<PlayResult>((resolve) => {
          finish = () => {
            mock.emitPhase({ phase: 'running' })
            resolve({ ok: true })
          }
        }),
    )
    fireEvent.click(button('遊ぶ'))
    act(() => mock.emitPhase({ phase: 'mods', done: 1, total: 3, fileName: 'test.jar' }))
    expect(screen.getByText('Mod をそろえています（1/3） test.jar')).toBeTruthy()
    expect(
      Number.parseFloat(document.querySelector<HTMLElement>('.progress')!.style.width),
    ).toBeCloseTo(100 / 3)
    act(() => mock.emitPhase({ phase: 'game', stage: 2, downloaded: 1024, total: 2048 }))
    expect(screen.getByText(/ゲーム本体を準備しています（段階 2/)).toBeTruthy()
    expect(document.querySelector<HTMLElement>('.progress')?.style.width).toBe('50%')
    await act(async () => finish!())
    expect((button('プレイ中') as HTMLButtonElement).disabled).toBe(true)
    act(() => mock.emitPhase({ phase: 'closed', code: 0 }))
    await waitFor(() => expect((button('遊ぶ') as HTMLButtonElement).disabled).toBe(false))
  })
  it('warn の構成ダイアログから、それでも遊ぶを呼ぶ', async () => {
    const mock = await start({ integrity: 'warn' })
    fireEvent.click(button('遊ぶ'))
    const dialog = await screen.findByRole('dialog', { name: '構成の確認' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'それでも遊ぶ' }))
    await waitFor(() => expect(mock.calls).toContain('playAnyway:hub'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('block には、それでも遊ぶを出さず、余分な Mod を外せる', async () => {
    const mock = await start({ integrity: 'block' })
    fireEvent.click(button('遊ぶ'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: 'それでも遊ぶ' })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'サーバーに無い Mod を外す' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mock.calls).toContain('retire:hub')
    expect(mock.calls).not.toContain('playAnyway:hub')
  })
  it('未ログインで遊ぶを押すと設定に移る', async () => {
    const mock = await start({ loggedIn: false })
    fireEvent.click(button('ログインして遊ぶ'))
    await screen.findByRole('heading', { name: '設定' })
    expect(button('ログイン')).toBeTruthy()
    expect(mock.calls).not.toContain('play:hub')
  })
  it('テーマと差し色を反映し、JVM 引数エラーを表示して Discord 連携を更新する', async () => {
    const mock = await start()
    fireEvent.click(button('設定'))
    await screen.findByRole('heading', { name: '設定' })
    fireEvent.click(button('ダーク'))
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'))
    fireEvent.click(button('海晶'))
    await waitFor(() => expect(document.documentElement.dataset.accent).toBe('prismarine'))
    fireEvent.change(screen.getByRole('textbox', { name: 'JVM 引数' }), {
      target: { value: '-Xmx4G' },
    })
    const field = screen.getByRole('textbox', { name: 'JVM 引数' }).parentElement!
    fireEvent.click(within(field).getByRole('button', { name: '保存' }))
    await screen.findByText('-Xmx は使えません（メモリは設定欄で決めます）')
    expect(mock.calls).not.toContain('saveSettings:{"java":{"jvmArgs":"-Xmx4G"}}')
    fireEvent.click(button('連携する'))
    await screen.findByText('steve_jp')
    expect(mock.calls).toContain('linkDiscord')
    fireEvent.click(button('連携を解除'))
    await screen.findByText('連携していません')
    expect(mock.calls).toContain('unlinkDiscord')
  })
  it('ログの絞り込みと新着行・伏せてコピーの結果を表示する', async () => {
    const mock = await start()
    fireEvent.click(button('ログ'))
    const view = await screen.findByLabelText('ログ', { selector: 'pre' })
    await waitFor(() => expect(view.textContent).toContain('Loading Minecraft'))
    fireEvent.change(screen.getByRole('textbox', { name: 'ログを絞り込む' }), {
      target: { value: 'warn' },
    })
    expect(view.textContent).toContain('Missing sound')
    expect(view.textContent).not.toContain('Loading Minecraft')
    act(() => mock.emitLog('[game] WARN new warning'))
    expect(view.textContent).toContain('new warning')
    fireEvent.click(button('伏せてコピー'))
    await waitFor(() =>
      expect(
        screen.getAllByText(/伏せたもの: トークン 1・UUID 2・プレイヤー名 1/).length,
      ).toBeGreaterThan(0),
    )
    expect(mock.calls).toContain('copyLog')
  })
})
