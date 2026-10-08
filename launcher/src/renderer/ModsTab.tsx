import { useState } from 'react'
import type { ModView, ServerDetail } from '../shared/ipc'
import { api, errorText } from './api'

function ModRow(props: { mod: ModView; children?: React.ReactNode }) {
  return (
    <li>
      <div className="grow">
        <div className="title">{props.mod.title}</div>
        <div className="num faint">{props.mod.versionNumber}</div>
      </div>
      {props.children}
    </li>
  )
}

export function ModsTab(props: {
  detail: ServerDetail
  onChange: (detail: ServerDetail) => void
  toast: (message: string) => void
}) {
  const { detail } = props
  const [busy, setBusy] = useState<string>()
  const required = detail.mods.filter((m) => m.side === 'required')
  const optional = detail.mods.filter((m) => m.side === 'optional')

  async function toggle(mod: ModView, enabled: boolean) {
    setBusy(mod.projectId)
    try {
      props.onChange(await api().setOptionalMod(detail.id, mod.projectId, enabled))
    } catch (e) {
      props.toast(errorText(e))
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <>
      <section className="section">
        <div className="section-head">
          <h2>必須</h2>
          <span className="num faint">{required.length}</span>
        </div>
        <p className="section-note">サーバーに入るために必要です。遊ぶを押すと自動でそろいます。</p>
        {required.length ? (
          <ul className="rows">
            {required.map((mod) => (
              <ModRow key={mod.projectId} mod={mod} />
            ))}
          </ul>
        ) : (
          <p className="faint">ありません。</p>
        )}
      </section>

      {optional.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>任意</h2>
            <span className="num faint">{optional.length}</span>
          </div>
          <p className="section-note">
            入れなくても遊べます。外したものは次に遊ぶときに取り除きます。
          </p>
          <ul className="rows">
            {optional.map((mod) => (
              <ModRow key={mod.projectId} mod={mod}>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={mod.enabled}
                    disabled={busy === mod.projectId}
                    onChange={(e) => void toggle(mod, e.target.checked)}
                    aria-label={`${mod.title} を入れる`}
                  />
                  <span />
                </label>
              </ModRow>
            ))}
          </ul>
        </section>
      )}

      {detail.serverOnly.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>サーバーのみ</h2>
            <span className="num faint">{detail.serverOnly.length}</span>
          </div>
          <p className="section-note">サーバー側だけで動くので、この PC には入れません。</p>
          <p className="muted">{detail.serverOnly.join('、')}</p>
        </section>
      )}
    </>
  )
}
