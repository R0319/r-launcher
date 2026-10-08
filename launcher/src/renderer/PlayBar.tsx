import { useEffect, useRef, useState } from 'react'
import type { IntegrityView, PlayPhase, ServerDetail, ServerView } from '../shared/ipc'
import { api, errorText, formatBytes } from './api'
import { IntegrityNotice } from './IntegrityNotice'

export function phaseText(phase: PlayPhase | undefined): string {
  if (!phase) return ''
  switch (phase.phase) {
    case 'manifest':
      return 'サーバーの構成を確かめています'
    case 'mods':
      return `Mod をそろえています（${phase.done}/${phase.total}）${phase.fileName ? ` ${phase.fileName}` : ''}`
    case 'check':
      return '構成を確かめています'
    case 'game':
      return `ゲーム本体を準備しています（段階 ${phase.stage}・${formatBytes(phase.downloaded)} / ${formatBytes(phase.total)}）`
    case 'launching':
      return '起動しています'
    case 'running':
      return 'プレイ中'
    case 'closed':
      return phase.code && phase.code !== 0
        ? `ゲームが終了しました（コード ${phase.code}）。ログを確かめてください`
        : ''
  }
}

function progressOf(phase: PlayPhase | undefined): number | null {
  if (!phase) return null
  if (phase.phase === 'mods' && phase.total) return phase.done / phase.total
  if (phase.phase === 'game' && phase.total) return Math.min(1, phase.downloaded / phase.total)
  return null
}

export function PlayBar(props: {
  server: ServerView
  detail?: ServerDetail
  loggedIn: boolean
  onNeedLogin: () => void
  onDetail: (detail: ServerDetail) => void
  onFinished: () => void
}) {
  const [phase, setPhase] = useState<PlayPhase>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [blocked, setBlocked] = useState<IntegrityView>()

  // 購読は 1 回だけにし、最新の onFinished を ref から呼ぶ
  const onFinished = useRef(props.onFinished)
  onFinished.current = props.onFinished
  useEffect(
    () =>
      api().onPlayProgress((p) => {
        setPhase(p)
        if (p.phase === 'closed') onFinished.current()
      }),
    [],
  )

  const running = phase?.phase === 'running' || phase?.phase === 'launching'

  async function start(force: boolean) {
    if (!props.loggedIn) return props.onNeedLogin()
    setBusy(true)
    setError(undefined)
    setBlocked(undefined)
    try {
      const result = force
        ? await api().playAnyway(props.server.id)
        : await api().play(props.server.id)
      if (!result.ok && result.reason === 'integrity') setBlocked(result.integrity)
      if (!result.ok && result.reason === 'error') setError(result.message)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const progress = progressOf(phase)
  const label = !props.loggedIn
    ? 'ログインして遊ぶ'
    : busy
      ? '準備中…'
      : running
        ? 'プレイ中'
        : props.server.installed
          ? '遊ぶ'
          : 'インストールして遊ぶ'

  return (
    <>
      {blocked && (
        <div className="dialog-back" role="dialog" aria-modal="true" aria-label="構成の確認">
          <div className="dialog">
            <h2>構成を確かめてください</h2>
            <IntegrityNotice
              integrity={blocked}
              policy={props.detail?.policy.mode ?? 'warn'}
              onRetire={async () => {
                props.onDetail(await api().retireExtraMods(props.server.id))
                setBlocked(undefined)
              }}
            />
            <div className="actions">
              <button type="button" className="btn quiet" onClick={() => setBlocked(undefined)}>
                閉じる
              </button>
              {blocked.verdict === 'warn' && (
                <button type="button" className="btn" onClick={() => void start(true)}>
                  それでも遊ぶ
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="playbar">
        {progress !== null && busy && (
          <div className="progress" style={{ width: `${progress * 100}%` }} />
        )}
        <div className="progress-text" aria-live="polite">
          {error ? (
            <span className="error-text">{error}</span>
          ) : (
            phaseText(busy || running ? phase : phase?.phase === 'closed' ? phase : undefined)
          )}
        </div>
        <button
          type="button"
          className="btn primary play"
          disabled={busy || running || props.server.state !== 'running'}
          onClick={() => void start(false)}
          title={props.server.state !== 'running' ? 'サーバーが止まっています' : undefined}
        >
          {props.server.state !== 'running' && !busy ? 'サーバー停止中' : label}
        </button>
      </div>
    </>
  )
}
