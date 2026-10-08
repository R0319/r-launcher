import { useCallback, useEffect, useState } from 'react'
import type { AppState, PingView, ServerDetail, ServerView } from '../shared/ipc'
import { AddonsTab } from './AddonsTab'
import { api, errorText, loaderLabel } from './api'
import { IntegrityNotice } from './IntegrityNotice'
import { ModsTab } from './ModsTab'
import { PlayBar } from './PlayBar'
import { stateLabel } from './Rail'

type Tab = 'mods' | 'resourcepack' | 'shader'

export function ServerPane(props: {
  server: ServerView
  state: AppState
  toast: (message: string) => void
  onAfterPlay: () => void
  onNeedLogin: () => void
}) {
  const { server } = props
  const [detail, setDetail] = useState<ServerDetail>()
  const [detailError, setDetailError] = useState<string>()
  const [ping, setPing] = useState<PingView | null>()
  const [tab, setTab] = useState<Tab>('mods')

  const loadDetail = useCallback(async () => {
    setDetailError(undefined)
    try {
      setDetail(await api().serverDetail(server.id))
    } catch (e) {
      setDetailError(errorText(e))
    }
  }, [server.id])

  useEffect(() => {
    void loadDetail()
    let alive = true
    if (server.state === 'running') {
      api()
        .pingServer(server.id)
        .then(
          (result) => alive && setPing(result),
          () => alive && setPing(null),
        )
    }
    return () => {
      alive = false
    }
  }, [server.id, server.state, loadDetail])

  const players =
    ping ?? (server.online ? { online: server.online.players, max: server.online.max } : null)

  return (
    <>
      <div className="main-scroll">
        <div className="page">
          <h1 className="server-title">{server.name}</h1>
          <div className="status-line">
            <span className="state" data-state={server.state}>
              {stateLabel[server.state] ?? server.state}
            </span>
            {players && (
              <span className="num">
                {players.online} / {players.max} 人
              </span>
            )}
            {ping && <span className="num">{ping.latencyMs} ms</span>}
            <span className="num">
              {loaderLabel[server.loader] ?? server.loader} {server.mcVersion}
              {detail ? ` (${detail.loaderVersion})` : ''}
            </span>
            <span className="num faint">
              {server.host}
              {server.port !== 25565 ? `:${server.port}` : ''}
            </span>
          </div>
          {ping?.motd && <p className="motd">{ping.motd}</p>}

          {detail?.integrity && detail.integrity.verdict !== 'ok' && (
            <div style={{ marginTop: 20 }}>
              <IntegrityNotice
                integrity={detail.integrity}
                policy={detail.policy.mode}
                onRetire={async () => setDetail(await api().retireExtraMods(server.id))}
              />
            </div>
          )}

          <div className="tabs" role="tablist">
            {(
              [
                ['mods', 'Mod', detail?.mods.length],
                ['resourcepack', 'リソースパック', detail?.resourcepacks.length],
                ['shader', 'シェーダー', detail?.shaders.length],
              ] as const
            ).map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                role="tab"
                className="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
              >
                {label}
                {count !== undefined && <span className="count num">{count}</span>}
              </button>
            ))}
          </div>

          {detailError && (
            <div className="notice danger">
              {detailError}
              <div className="actions">
                <button type="button" className="btn" onClick={() => void loadDetail()}>
                  もう一度読み込む
                </button>
              </div>
            </div>
          )}
          {detail && tab === 'mods' && (
            <ModsTab detail={detail} onChange={setDetail} toast={props.toast} />
          )}
          {detail && tab !== 'mods' && (
            <AddonsTab
              key={tab}
              type={tab}
              detail={detail}
              onChange={setDetail}
              toast={props.toast}
            />
          )}
        </div>
      </div>
      <PlayBar
        server={server}
        detail={detail}
        loggedIn={!!props.state.account}
        onNeedLogin={props.onNeedLogin}
        onDetail={setDetail}
        onFinished={() => {
          props.onAfterPlay()
          void loadDetail()
        }}
      />
    </>
  )
}
