import { useState } from 'react'
import type { IntegrityView } from '../shared/ipc'
import { errorText } from './api'

/** サーバーと構成が違うときの説明。直し方（余分な Mod を退避）もここから選べる */
export function IntegrityNotice(props: {
  integrity: IntegrityView
  policy: 'off' | 'warn' | 'block'
  onRetire: () => Promise<void>
  extraActions?: React.ReactNode
}) {
  const { integrity } = props
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const blocked = integrity.extras.filter((e) => !e.allowed)
  const block = integrity.verdict === 'block'

  return (
    <div className={`notice ${block ? 'danger' : 'warn'}`} role="alert">
      <strong>
        {block
          ? 'サーバーと Mod の構成が違うため、このままでは遊べません。'
          : 'サーバーと Mod の構成が違います。このまま遊ぶと接続を断られることがあります。'}
      </strong>
      <ul>
        {integrity.missing.length > 0 && (
          <li>足りない Mod: {integrity.missing.join('、')}（遊ぶを押すと入ります）</li>
        )}
        {integrity.mismatched.length > 0 && (
          <li>中身が違う Mod: {integrity.mismatched.join('、')}</li>
        )}
        {blocked.length > 0 && (
          <li>サーバーに無い Mod: {blocked.map((e) => e.fileName).join('、')}</li>
        )}
      </ul>
      {error && <p className="error-text">{error}</p>}
      <div className="actions">
        {blocked.length > 0 && (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setError(undefined)
              try {
                await props.onRetire()
              } catch (e) {
                setError(errorText(e))
              } finally {
                setBusy(false)
              }
            }}
          >
            サーバーに無い Mod を外す
          </button>
        )}
        {props.extraActions}
      </div>
      {blocked.length > 0 && (
        <p className="faint" style={{ marginTop: 6, fontSize: 12.5 }}>
          外した Mod は削除せず、ゲームフォルダの mods-disabled に移します。
        </p>
      )}
    </div>
  )
}
