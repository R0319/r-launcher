import { useState, type FormEvent } from 'react'
import type { AddonHit, AddonType, InstalledAddon, ServerDetail } from '../shared/ipc'
import { api, errorText, formatBytes, formatCount } from './api'
import { IconFolder } from './Icons'

const words: Record<AddonType, { name: string; folder: 'resourcepacks' | 'shaderpacks' }> = {
  resourcepack: { name: 'リソースパック', folder: 'resourcepacks' },
  shader: { name: 'シェーダー', folder: 'shaderpacks' },
}

export function AddonsTab(props: {
  type: AddonType
  detail: ServerDetail
  onChange: (detail: ServerDetail) => void
  toast: (message: string) => void
}) {
  const { type, detail } = props
  const word = words[type]
  const installed: InstalledAddon[] = type === 'shader' ? detail.shaders : detail.resourcepacks
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<AddonHit[]>()
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string>()
  const [busy, setBusy] = useState<string>()
  const unusable = type === 'shader' && !detail.shaderLoader

  async function run(task: string, fn: () => Promise<ServerDetail>, done?: string) {
    setBusy(task)
    try {
      props.onChange(await fn())
      if (done) props.toast(done)
    } catch (e) {
      props.toast(errorText(e))
    } finally {
      setBusy(undefined)
    }
  }

  async function search(event: FormEvent) {
    event.preventDefault()
    setSearching(true)
    setSearchError(undefined)
    try {
      setHits(await api().searchAddons({ type, serverId: detail.id, query, offset: 0 }))
    } catch (e) {
      setSearchError(errorText(e))
    } finally {
      setSearching(false)
    }
  }

  return (
    <>
      {unusable && (
        <div className="notice warn">
          このサーバーの構成には Iris / Oculus
          が入っていないため、シェーダーは使えません。必要なら管理者に頼んでください。
        </div>
      )}
      <section className="section">
        <div className="section-head">
          <h2>入っている{word.name}</h2>
          <button
            type="button"
            className="btn quiet"
            onClick={() =>
              api()
                .openFolder(detail.id, word.folder)
                .catch((e: unknown) => props.toast(errorText(e)))
            }
          >
            <IconFolder /> フォルダを開く
          </button>
        </div>
        {installed.length ? (
          <ul className="rows">
            {installed.map((item) => (
              <li key={item.fileName}>
                <div className="grow">
                  <div className="title">{item.fileName}</div>
                  <div className="num faint">{formatBytes(item.sizeBytes)}</div>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={item.enabled}
                    disabled={!!busy || unusable}
                    aria-label={`${item.fileName} を使う`}
                    onChange={(e) =>
                      void run(item.fileName, () =>
                        api().setAddonEnabled({
                          type,
                          serverId: detail.id,
                          fileName: item.fileName,
                          enabled: e.target.checked,
                        }),
                      )
                    }
                  />
                  <span />
                </label>
                <button
                  type="button"
                  className="btn quiet danger"
                  disabled={!!busy}
                  onClick={() =>
                    void run(
                      item.fileName,
                      () =>
                        api().removeAddon({ type, serverId: detail.id, fileName: item.fileName }),
                      `${item.fileName} をごみ箱に移しました`,
                    )
                  }
                >
                  外す
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="faint">まだありません。下の検索から入れられます。</p>
        )}
        {type === 'shader' && installed.length > 0 && (
          <p className="section-note" style={{ marginTop: 8 }}>
            使えるシェーダーは 1 つだけです。別のものを選ぶと切り替わります。
          </p>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>{word.name}を探す</h2>
          <span className="faint">Modrinth・Minecraft {detail.mcVersion} 対応のもの</span>
        </div>
        <form className="search-bar" onSubmit={search}>
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={type === 'shader' ? '例: Complementary' : '例: Faithful'}
            aria-label={`${word.name}の検索`}
            maxLength={100}
          />
          <button type="submit" className="btn" disabled={searching || unusable}>
            {searching ? '検索中…' : '検索'}
          </button>
        </form>
        {searchError && <p className="error-text">{searchError}</p>}
        {hits && hits.length === 0 && <p className="faint">見つかりませんでした。</p>}
        {hits && hits.length > 0 && (
          <ul className="rows">
            {hits.map((hit) => (
              <li key={hit.projectId}>
                {hit.iconUrl ? (
                  <img className="hit-icon" src={hit.iconUrl} alt="" />
                ) : (
                  <span className="hit-icon" />
                )}
                <div className="grow">
                  <div className="title">
                    {hit.title} <span className="faint">{hit.author}</span>
                  </div>
                  <div className="hit-desc">{hit.description}</div>
                </div>
                <span className="num faint">{formatCount(hit.downloads)}</span>
                <button
                  type="button"
                  className="btn"
                  disabled={!!busy || unusable}
                  onClick={() =>
                    void run(
                      hit.projectId,
                      () =>
                        api().installAddon({ type, serverId: detail.id, projectId: hit.projectId }),
                      `${hit.title} を入れて有効にしました`,
                    )
                  }
                >
                  {busy === hit.projectId ? '入れています…' : '入れる'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
