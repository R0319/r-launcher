import { useState } from 'react'
import type { AppState } from '../shared/ipc'
import { api, errorText } from './api'

/** 初回だけ: ゲームデータの保存先 → Microsoft ログイン（後からでもよい） */
export function Setup(props: { state: AppState; onChange: (state: AppState) => void }) {
  const { state } = props
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const dir = state.settings.instanceBaseDir

  async function run(fn: () => Promise<AppState | null | string>) {
    setBusy(true)
    setError(undefined)
    try {
      await fn()
      props.onChange(await api().getState())
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="setup">
      <div className="setup-box">
        <h1>R-Launcher を使う準備</h1>
        <p className="muted">最初に 2 つだけ決めてください。どちらも後から設定で変えられます。</p>
        <ol className="setup-steps">
          <li>
            <span className="step-no">1</span>
            <div>
              <div>ゲームデータの保存先</div>
              <div className="num faint">{dir ?? 'まだ選んでいません'}</div>
            </div>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void run(() => api().chooseInstanceDir())}
            >
              {dir ? '変える' : '選ぶ'}
            </button>
          </li>
          <li>
            <span className="step-no">2</span>
            <div>
              <div>Microsoft アカウント</div>
              <div className="faint">
                {state.account ? state.account.name : 'ログインしていません'}
              </div>
            </div>
            {!state.account && (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void run(() => api().loginMicrosoft())}
              >
                ログイン
              </button>
            )}
          </li>
        </ol>
        {error && (
          <p className="error-text" style={{ marginTop: 12 }}>
            {error}
          </p>
        )}
        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !dir}
            onClick={() => void run(() => api().completeSetup())}
          >
            始める
          </button>
        </div>
      </div>
    </div>
  )
}
