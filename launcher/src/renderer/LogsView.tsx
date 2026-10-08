import { useEffect, useRef, useState } from 'react'
import type { LogCopyResult } from '../shared/ipc'
import { api, errorText } from './api'
import { IconFolder } from './Icons'

const MAX_LINES = 3000

function levelOf(line: string): 'error' | 'warn' | undefined {
  if (/\b(ERROR|FATAL|Exception)\b|起動に失敗/.test(line)) return 'error'
  if (/\bWARN\b/.test(line)) return 'warn'
  return undefined
}

const kindLabel: Record<string, string> = {
  token: 'トークン',
  uuid: 'UUID',
  player: 'プレイヤー名',
  path: 'ユーザー名入りのパス',
  ip: 'IP アドレス',
  email: 'メールアドレス',
  discord: 'Discord の情報',
}

export function maskedSummary(result: LogCopyResult): string {
  const parts = Object.entries(result.masked)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${kindLabel[kind] ?? kind} ${count}`)
  return parts.length ? `伏せたもの: ${parts.join('・')}` : '伏せる必要のある情報はありませんでした'
}

export function LogsView(props: { toast: (message: string) => void }) {
  const [lines, setLines] = useState<string[]>([])
  const [filter, setFilter] = useState('')
  const [last, setLast] = useState<string>()
  const view = useRef<HTMLPreElement>(null)

  useEffect(() => {
    let alive = true
    api()
      .readLog()
      .then((text) => alive && setLines(text ? text.split('\n').slice(-MAX_LINES) : []))
    const off = api().onLogLine((line) =>
      setLines((prev) => [...prev.slice(-(MAX_LINES - 1)), line]),
    )
    return () => {
      alive = false
      off()
    }
  }, [])

  useEffect(() => {
    const el = view.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines.length])

  const shown = filter ? lines.filter((l) => l.toLowerCase().includes(filter.toLowerCase())) : lines

  async function share(kind: 'copy' | 'save') {
    try {
      const result = kind === 'copy' ? await api().copyLog() : await api().saveLog()
      if (!result) return
      const summary = maskedSummary(result)
      setLast(summary)
      props.toast(kind === 'copy' ? `コピーしました。${summary}` : `保存しました。${summary}`)
    } catch (e) {
      props.toast(errorText(e))
    }
  }

  return (
    <div className="main-scroll">
      <div className="page" style={{ maxWidth: 'none' }}>
        <div className="section-head">
          <h1 className="server-title">ログ</h1>
          <div className="control" style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn primary" onClick={() => void share('copy')}>
              伏せてコピー
            </button>
            <button type="button" className="btn" onClick={() => void share('save')}>
              伏せて保存
            </button>
            <button
              type="button"
              className="btn quiet"
              onClick={() =>
                api()
                  .openFolder('logs', 'logs')
                  .catch((e: unknown) => props.toast(errorText(e)))
              }
            >
              <IconFolder /> フォルダ
            </button>
          </div>
        </div>
        <p className="section-note">
          困ったときは「伏せてコピー」して管理者に送ってください。トークン・UUID・アカウント名・PC
          のユーザー名・IP アドレス・メールアドレスは伏せ字になります。
          {last && <span className="faint"> （前回: {last}）</span>}
        </p>
        <div className="search-bar">
          <input
            className="input"
            placeholder="ログを絞り込む"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="ログを絞り込む"
          />
        </div>
        <pre className="log-view" ref={view} aria-label="ログ">
          {shown.length === 0 && <span className="faint">まだログはありません。</span>}
          {shown.map((line, i) => (
            <div key={i} className="log-line" data-level={levelOf(line)}>
              {line}
            </div>
          ))}
        </pre>
      </div>
    </div>
  )
}
