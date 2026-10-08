import { useCallback, useEffect, useState } from 'react'
import type { AppState, ServerView } from '../shared/ipc'
import { api, errorText } from './api'
import { LogsView } from './LogsView'
import { Rail, type View } from './Rail'
import { ServerPane } from './ServerPane'
import { SettingsView } from './SettingsView'
import { Setup } from './Setup'
import { Toast, useToast } from './Toast'

function useTheme(state: AppState | null) {
  useEffect(() => {
    if (!state) return
    const { theme, accent, backgroundDim } = state.settings.appearance
    const root = document.documentElement
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    const apply = () => {
      root.dataset.theme = theme === 'system' ? (media?.matches ? 'dark' : 'light') : theme
    }
    apply()
    root.dataset.accent = accent
    root.style.setProperty('--dim', String(backgroundDim / 100))
    media?.addEventListener?.('change', apply)
    return () => media?.removeEventListener?.('change', apply)
  }, [state])
}

export function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [fatal, setFatal] = useState<string>()
  const [servers, setServers] = useState<ServerView[]>()
  const [serversError, setServersError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [view, setView] = useState<View>({ kind: 'server' })
  const toast = useToast()
  useTheme(state)

  useEffect(() => {
    api()
      .getState()
      .then(setState, (e: unknown) => setFatal(errorText(e)))
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    setServersError(undefined)
    try {
      setServers(await api().listServers())
    } catch (e) {
      setServersError(errorText(e))
    } finally {
      setLoading(false)
    }
  }, [])

  const ready = !!state?.setupCompleted
  useEffect(() => {
    if (ready) void reload()
  }, [ready, reload])

  if (fatal) return <div className="setup">{fatal}</div>
  if (!state) return <div className="setup muted">読み込み中…</div>
  if (!state.setupCompleted) return <Setup state={state} onChange={setState} />

  const selectedId =
    servers?.find((s) => s.id === state.settings.selectedServerId)?.id ?? servers?.[0]?.id ?? null
  const selected = servers?.find((s) => s.id === selectedId)

  const select = (id: string) => {
    setView({ kind: 'server' })
    void api()
      .saveSettings({ selectedServerId: id })
      .then(setState, (e: unknown) => toast.show(errorText(e)))
  }

  return (
    <div className="shell">
      <Rail
        servers={servers}
        error={serversError}
        loading={loading}
        selectedId={selectedId}
        view={view}
        account={state.account}
        onSelect={select}
        onView={setView}
        onReload={() => void reload()}
      />
      <main className="main" aria-label="詳細">
        {state.backgroundUrl && view.kind === 'server' && (
          <div
            className="main-backdrop"
            style={{ backgroundImage: `url("${state.backgroundUrl}")` }}
          />
        )}
        {view.kind === 'settings' && (
          <SettingsView state={state} onChange={setState} toast={toast.show} />
        )}
        {view.kind === 'logs' && <LogsView toast={toast.show} />}
        {view.kind === 'server' &&
          (selected ? (
            <ServerPane
              key={selected.id}
              server={selected}
              state={state}
              toast={toast.show}
              onAfterPlay={() => void reload()}
              onNeedLogin={() => setView({ kind: 'settings' })}
            />
          ) : (
            <div className="main-scroll">
              <div className="page">
                {serversError ? (
                  <div className="notice danger" role="alert">
                    {serversError}
                    <div className="actions">
                      <button
                        type="button"
                        className="btn"
                        onClick={() => void reload()}
                        disabled={loading}
                      >
                        再読み込み
                      </button>
                      <button
                        type="button"
                        className="btn quiet"
                        onClick={() => setView({ kind: 'settings' })}
                      >
                        設定を開く
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="empty">
                    {servers ? '公開中のサーバーはありません。' : '読み込み中…'}
                  </p>
                )}
              </div>
            </div>
          ))}
      </main>
      <Toast message={toast.message} />
    </div>
  )
}
