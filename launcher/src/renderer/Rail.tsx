import iconUrl from './assets/icon-64.png'
import type { AccountView, ServerView } from '../shared/ipc'
import { loaderLabel } from './api'
import { IconLog, IconReload, IconSettings } from './Icons'

export type View = { kind: 'server' } | { kind: 'settings' } | { kind: 'logs' }

const stateLabel: Record<string, string> = {
  running: '稼働中',
  stopped: '停止中',
  starting: '起動中',
  stopping: '停止処理中',
  provisioning: '準備中',
  error: '異常',
}

export function serverSummary(server: ServerView) {
  const players =
    server.state === 'running' && server.online
      ? ` · ${server.online.players}/${server.online.max}`
      : ''
  return `${loaderLabel[server.loader] ?? server.loader} ${server.mcVersion}${players}`
}

export function Rail(props: {
  servers?: ServerView[]
  error?: string
  loading: boolean
  selectedId: string | null
  view: View
  account: AccountView | null
  onSelect: (id: string) => void
  onView: (view: View) => void
  onReload: () => void
}) {
  return (
    <nav className="rail" aria-label="サーバー">
      <div className="rail-head">
        <span className="wordmark">
          <img src={iconUrl} alt="" width={20} height={20} />
          R-Launcher
        </span>
        <button
          type="button"
          className="btn quiet"
          onClick={props.onReload}
          disabled={props.loading}
          aria-label="一覧を読み込み直す"
          title="一覧を読み込み直す"
        >
          <IconReload />
        </button>
      </div>
      <div className="rail-label">サーバー</div>
      <ul className="server-list">
        {props.error && <li className="account-line error-text">読み込めませんでした</li>}
        {!props.servers && !props.error && <li className="account-line">読み込み中…</li>}
        {props.servers?.map((server) => (
          <li key={server.id}>
            <button
              type="button"
              className="server-row"
              aria-current={props.view.kind === 'server' && server.id === props.selectedId}
              onClick={() => props.onSelect(server.id)}
            >
              <span className="state-mark" data-state={server.state} aria-hidden />
              <span>
                <span className="name">{server.name}</span>
                <span className="num muted">{serverSummary(server)}</span>
                <span className="sr-only"> {stateLabel[server.state] ?? server.state}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="rail-foot">
        <button
          type="button"
          className="rail-link"
          aria-current={props.view.kind === 'logs'}
          onClick={() => props.onView({ kind: 'logs' })}
        >
          <IconLog /> ログ
        </button>
        <button
          type="button"
          className="rail-link"
          aria-current={props.view.kind === 'settings'}
          onClick={() => props.onView({ kind: 'settings' })}
        >
          <IconSettings /> 設定
        </button>
        <div className="account-line">{props.account ? props.account.name : '未ログイン'}</div>
      </div>
    </nav>
  )
}

export { stateLabel }
