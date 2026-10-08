// mc-panel の公開 API（docs: mc-panel の docs/launcher-api.md）。応答はすべて契約のスキーマで検証する。
import { z } from 'zod'
import {
  LauncherManifestSchema,
  LinkStartSchema,
  LinkStatusSchema,
  LinkVerifySchema,
  PackSummarySchema,
  ServerIdSchema,
  type LauncherManifest,
  type PackSummary,
} from '../shared/contract'
import type { Http } from './http'

/** Panel の URL として受け付ける形（https のみ。開発用に localhost の http は可） */
export function normalizePanelUrl(raw: string): string | null {
  const text = raw.trim().replace(/\/+$/, '')
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.username || url.password || url.search || url.hash) return null
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`
}

export class PanelClient {
  constructor(
    private readonly http: Http,
    private readonly baseUrl: string,
  ) {}

  /** 一覧のうち形の正しいものだけ返す（1 件壊れていても、ほかは表示する） */
  async listPacks(): Promise<PackSummary[]> {
    const raw = await this.http.getJson(`${this.baseUrl}/packs`, z.array(z.unknown()).max(200))
    return raw.flatMap((item) => {
      const parsed = PackSummarySchema.safeParse(item)
      if (!parsed.success) console.warn('[panel] 形の違うサーバーを読み飛ばしました')
      return parsed.success ? [parsed.data] : []
    })
  }

  async manifest(serverId: string): Promise<LauncherManifest> {
    const id = ServerIdSchema.parse(serverId)
    const manifest = await this.http.getJson(
      `${this.baseUrl}/packs/${id}/launcher.json`,
      LauncherManifestSchema,
    )
    if (manifest.id !== id) throw new Error('Panel の応答が別のサーバーのものです')
    return manifest
  }

  linkStart() {
    return this.http.postJson(`${this.baseUrl}/api/v1/link/start`, {}, LinkStartSchema)
  }

  linkVerify(linkId: string, username: string) {
    return this.http.postJson(
      `${this.baseUrl}/api/v1/link/verify`,
      { linkId, username },
      LinkVerifySchema,
    )
  }

  linkStatus(linkId: string) {
    return this.http.getJson(
      `${this.baseUrl}/api/v1/link/status?linkId=${encodeURIComponent(linkId)}`,
      LinkStatusSchema,
    )
  }

  linkUnlink(linkId: string) {
    return this.http.postJson(
      `${this.baseUrl}/api/v1/link/unlink`,
      { linkId },
      z.object({}).passthrough(),
    )
  }
}
