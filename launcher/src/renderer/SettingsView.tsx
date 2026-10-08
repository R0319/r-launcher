import { useEffect, useState } from 'react'
import type { AppState, JavaView, SettingsPatch, UpdateStatus } from '../shared/ipc'
import type { Accent } from '../shared/settings'
import { api, errorText } from './api'

const accents: Array<{ key: Accent; label: string; color: string }> = [
  { key: 'copper', label: '銅', color: '#b4623a' },
  { key: 'grass', label: '草', color: '#4d7a2f' },
  { key: 'prismarine', label: '海晶', color: '#2c7a72' },
  { key: 'redstone', label: 'レッドストーン', color: '#a3322b' },
  { key: 'gold', label: '金', color: '#9a7414' },
]

type Props = {
  state: AppState
  onChange: (state: AppState) => void
  toast: (message: string) => void
}

/** 失敗したら toast で知らせる、共通の実行 */
function useRunner(props: Props) {
  const [busy, setBusy] = useState<string>()
  const run = async (key: string, fn: () => Promise<AppState | void>, done?: string) => {
    setBusy(key)
    try {
      const next = await fn()
      if (next) props.onChange(next)
      if (done) props.toast(done)
    } catch (e) {
      props.toast(errorText(e))
    } finally {
      setBusy(undefined)
    }
  }
  return { busy, run }
}

export function SettingsView(props: Props) {
  return (
    <div className="main-scroll">
      <div className="page">
        <h1 className="server-title">設定</h1>
        <AccountSection {...props} />
        <GameSection {...props} />
        <AppearanceSection {...props} />
        <ConnectionSection {...props} />
      </div>
    </div>
  )
}

function AccountSection(props: Props) {
  const { state } = props
  const { busy, run } = useRunner(props)
  const save = (patch: SettingsPatch) => run('save', () => api().saveSettings(patch))
  return (
    <section className="section" style={{ marginTop: 32 }}>
      <div className="section-head">
        <h2>アカウント</h2>
      </div>
      <div className="field">
        <span className="label">Microsoft</span>
        <div>
          <div className="control">
            <span>{state.account ? state.account.name : 'ログインしていません'}</span>
            {state.account ? (
              <button
                type="button"
                className="btn quiet"
                disabled={!!busy}
                onClick={() => void run('logout', () => api().logout())}
              >
                ログアウト
              </button>
            ) : (
              <button
                type="button"
                className="btn primary"
                disabled={!!busy}
                onClick={() => void run('login', () => api().loginMicrosoft())}
              >
                {busy === 'login' ? 'ログイン中…' : 'ログイン'}
              </button>
            )}
          </div>
          <p className="help">
            オンラインのサーバーで遊ぶには、Minecraft を購入した Microsoft アカウントが必要です。
          </p>
        </div>
      </div>
      <div className="field">
        <span className="label">Discord</span>
        <div>
          <div className="control">
            <span>{state.discord ? state.discord.name : '連携していません'}</span>
            {state.discord ? (
              <button
                type="button"
                className="btn quiet"
                disabled={!!busy || !state.account}
                onClick={() =>
                  void run('unlink', () => api().unlinkDiscord(), 'Discord との連携を解除しました')
                }
              >
                連携を解除
              </button>
            ) : (
              <button
                type="button"
                className="btn"
                disabled={!!busy || !state.account}
                onClick={() =>
                  void run('link', () => api().linkDiscord(), 'Discord と連携しました')
                }
              >
                {busy === 'link' ? 'ブラウザで許可してください…' : '連携する'}
              </button>
            )}
          </div>
          <p className="help">
            サーバーの管理者が、プレイヤーの Discord 名を確認できるようになります。連携には
            Microsoft のログインが必要です。
          </p>
        </div>
      </div>
      <div className="field">
        <span className="label">Discord に表示</span>
        <div>
          <label className="switch">
            <input
              type="checkbox"
              checked={state.settings.discordRichPresence}
              onChange={(e) => void save({ discordRichPresence: e.target.checked })}
            />
            <span />
            遊んでいるサーバー名を Discord のステータスに出す
          </label>
        </div>
      </div>
    </section>
  )
}

function GameSection(props: Props) {
  const { state } = props
  const java = state.settings.java
  const { busy, run } = useRunner(props)
  const [javaView, setJavaView] = useState<JavaView>()
  const [args, setArgs] = useState(java.jvmArgs)
  const [argsError, setArgsError] = useState<string>()
  const maxAllowed = Math.max(1024, state.totalMemoryMb - 2048)
  const [memory, setMemory] = useState(Math.min(java.memoryMaxMb, maxAllowed))

  useEffect(() => {
    api()
      .checkJava()
      .then(setJavaView, () => undefined)
  }, [java.mode, java.path])

  const save = (patch: SettingsPatch) => run('save', () => api().saveSettings(patch))

  async function saveArgs() {
    const check = await api().checkJvmArgs(args)
    if (!check.ok) return setArgsError(check.error)
    setArgsError(undefined)
    await save({ java: { jvmArgs: args } })
  }

  return (
    <section className="section">
      <div className="section-head">
        <h2>ゲーム</h2>
      </div>
      <div className="field">
        <span className="label">Java</span>
        <div>
          <div className="control">
            <div className="segmented" role="group" aria-label="Java の選び方">
              <button
                type="button"
                aria-pressed={java.mode === 'auto'}
                onClick={() => void save({ java: { mode: 'auto' } })}
              >
                自動で用意する
              </button>
              <button
                type="button"
                aria-pressed={java.mode === 'manual'}
                onClick={() =>
                  void run('java', async () => {
                    await api().chooseJava()
                    return api().getState()
                  })
                }
              >
                指定する
              </button>
            </div>
          </div>
          {java.mode === 'auto' ? (
            <p className="help">
              Minecraft の版に合う Java を、初回に自動でダウンロードします（Mojang 公式の配布物）。
            </p>
          ) : (
            <p className="help">
              <span className="num">{java.path}</span>
              {javaView?.detectedVersion
                ? `（Java ${javaView.detectedVersion}）`
                : '（確認できません）'}
            </p>
          )}
        </div>
      </div>
      <div className="field">
        <label htmlFor="memory">メモリ</label>
        <div>
          <div className="control">
            <input
              id="memory"
              type="range"
              min={1024}
              max={maxAllowed}
              step={512}
              value={memory}
              onChange={(e) => setMemory(Number(e.target.value))}
              onPointerUp={() => void save({ java: { memoryMaxMb: memory } })}
              onKeyUp={() => void save({ java: { memoryMaxMb: memory } })}
              style={{ width: 260 }}
            />
            <span className="num">{(memory / 1024).toFixed(1)} GB</span>
          </div>
          <p className="help">
            この PC のメモリは{' '}
            <span className="num">{(state.totalMemoryMb / 1024).toFixed(0)} GB</span>
            です。Mod が多いサーバーでは 6〜8 GB が目安です。多すぎると PC 全体が遅くなります。
          </p>
        </div>
      </div>
      <div className="field">
        <label htmlFor="jvm-args">JVM 引数</label>
        <div>
          <textarea
            id="jvm-args"
            className="input"
            rows={2}
            style={{ width: '100%' }}
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            placeholder="例: -XX:+UseZGC -XX:+ZGenerational"
            spellCheck={false}
          />
          <div className="control" style={{ marginTop: 6 }}>
            <button
              type="button"
              className="btn"
              disabled={!!busy || args === java.jvmArgs}
              onClick={() => void saveArgs()}
            >
              保存
            </button>
            {argsError && <span className="error-text">{argsError}</span>}
          </div>
          <p className="help">
            分からなければ空のままにしてください。メモリの指定（-Xmx など）は上の欄で行います。
          </p>
        </div>
      </div>
    </section>
  )
}

function AppearanceSection(props: Props) {
  const appearance = props.state.settings.appearance
  const { busy, run } = useRunner(props)
  const [dim, setDim] = useState(appearance.backgroundDim)
  const save = (patch: SettingsPatch['appearance']) =>
    run('save', () => api().saveSettings({ appearance: patch }))
  return (
    <section className="section">
      <div className="section-head">
        <h2>見た目</h2>
      </div>
      <div className="field">
        <span className="label">テーマ</span>
        <div className="control">
          <div className="segmented" role="group" aria-label="テーマ">
            {(
              [
                ['system', 'OS に合わせる'],
                ['light', 'ライト'],
                ['dark', 'ダーク'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={appearance.theme === key}
                onClick={() => void save({ theme: key })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="field">
        <span className="label">差し色</span>
        <div className="swatches" role="group" aria-label="差し色">
          {accents.map((accent) => (
            <button
              key={accent.key}
              type="button"
              className="swatch"
              aria-pressed={appearance.accent === accent.key}
              onClick={() => void save({ accent: accent.key })}
            >
              <i style={{ background: accent.color }} />
              {accent.label}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="label">背景</span>
        <div>
          <div className="control">
            <button
              type="button"
              className="btn"
              disabled={!!busy}
              onClick={() => void run('bg', () => api().chooseBackground())}
            >
              画像を選ぶ
            </button>
            {props.state.backgroundUrl && (
              <button
                type="button"
                className="btn quiet"
                disabled={!!busy}
                onClick={() => void run('bg', () => api().clearBackground())}
              >
                背景をなくす
              </button>
            )}
          </div>
          <p className="help">
            PNG・JPEG・WebP（10MB まで）。サーバーの詳細画面の後ろに表示します。
          </p>
          {props.state.backgroundUrl && (
            <div className="control" style={{ marginTop: 8 }}>
              <label htmlFor="dim" className="muted">
                暗さ
              </label>
              <input
                id="dim"
                type="range"
                min={0}
                max={80}
                step={5}
                value={dim}
                onChange={(e) => setDim(Number(e.target.value))}
                onPointerUp={() => void save({ backgroundDim: dim })}
                onKeyUp={() => void save({ backgroundDim: dim })}
              />
              <span className="num">{dim}%</span>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function ConnectionSection(props: Props) {
  const { state } = props
  const { busy, run } = useRunner(props)
  const [url, setUrl] = useState(state.settings.panelUrl)
  const [update, setUpdate] = useState<UpdateStatus>()
  useEffect(() => api().onUpdateStatus(setUpdate), [])
  return (
    <section className="section">
      <div className="section-head">
        <h2>接続とこのアプリ</h2>
      </div>
      <div className="field">
        <label htmlFor="panel-url">Panel の URL</label>
        <div>
          <div className="control">
            <input
              id="panel-url"
              className="input"
              style={{ width: 340 }}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              spellCheck={false}
            />
            <button
              type="button"
              className="btn"
              disabled={!!busy || url === state.settings.panelUrl}
              onClick={() =>
                void run(
                  'url',
                  () => api().saveSettings({ panelUrl: url }),
                  '保存しました。一覧を読み込み直してください',
                )
              }
            >
              保存
            </button>
          </div>
          <p className="help">通常は変える必要はありません。</p>
        </div>
      </div>
      <div className="field">
        <span className="label">バージョン</span>
        <div className="control">
          <span className="num">{state.version}</span>
          {update?.state === 'downloading' && (
            <span className="muted">更新をダウンロード中（{update.percent}%）</span>
          )}
          {update?.state === 'downloaded' && (
            <button
              type="button"
              className="btn primary"
              onClick={() => void api().installUpdate()}
            >
              {update.version} に更新して再起動
            </button>
          )}
        </div>
      </div>
      <div className="field">
        <span className="label">ゲームデータ</span>
        <div className="control">
          <span className="num muted">{state.settings.instanceBaseDir}</span>
        </div>
      </div>
    </section>
  )
}
