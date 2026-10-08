// 手動の通し確認: 実際の mc-panel（開発用デモでよい）と Modrinth を相手に、ランチャーの部品を順に動かす。
// 使い方: npx tsx scripts/e2e-panel.ts http://localhost:8080 [serverId]
// ゲームは起動しない（Microsoft アカウントが要るため）。一時フォルダは最後に消す。
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Addons } from '../src/main/addons'
import { createHttp } from '../src/main/http'
import { checkIntegrity } from '../src/main/integrity'
import { applySync, planSync, readLocalJars, readManaged } from '../src/main/modSync'
import { normalizePanelUrl, PanelClient } from '../src/main/panel'

async function main() {
  const panelUrl = normalizePanelUrl(process.argv[2] ?? 'http://localhost:8080')
  if (!panelUrl) throw new Error('Panel の URL が正しくありません')
  const http = createHttp({ userAgent: 'R0319/r-launcher/2.0-e2e', allowHttpLocalhost: true })
  const panel = new PanelClient(http, panelUrl)

  const packs = await panel.listPacks()
  console.log(`1. 一覧: ${packs.map((p) => `${p.id}(${p.state})`).join(', ')}`)
  const id = process.argv[3] ?? packs[0]?.id
  if (!id) throw new Error('公開中のサーバーがありません')

  const manifest = await panel.manifest(id)
  const required = manifest.mods.filter((m) => m.side === 'required').length
  console.log(
    `2. マニフェスト: ${manifest.loader} ${manifest.loaderVersion} / MC ${manifest.mcVersion}・Mod ${manifest.mods.length}（必須 ${required}）・サーバーのみ ${manifest.serverOnly.length}・チェック ${manifest.integrity.mode}`,
  )

  const dir = mkdtempSync(path.join(os.tmpdir(), 'r-launcher-e2e-'))
  const modsDir = path.join(dir, 'mods')
  try {
    const download = (url: string, maxBytes: number) =>
      http.getBytes(url, { maxBytes, timeoutMs: 600_000 })
    const first = planSync({ manifest, disabledOptional: new Set(), local: [], managed: [] })
    const synced = await applySync({ modsDir, plan: first, download })
    console.log(`3. 同期: ${synced.installed.length} 個をダウンロードしてハッシュ一致を確認`)

    const again = planSync({
      manifest,
      disabledOptional: new Set(),
      local: await readLocalJars(modsDir),
      managed: await readManaged(modsDir),
    })
    console.log(
      `4. 2 回目の計画: ダウンロード ${again.download.length}・退避 ${again.retire.length}（どちらも 0 が正しい）`,
    )

    writeFileSync(path.join(modsDir, 'my-own-mod.jar'), 'user jar')
    const report = checkIntegrity({
      manifest,
      disabledOptional: new Set(),
      local: await readLocalJars(modsDir),
    })
    console.log(
      `5. 余分な jar を置いたときの判定: ${report.verdict}（余分 ${report.extras.map((e) => e.fileName).join(', ')}）`,
    )

    const optional = manifest.mods.find((m) => m.side === 'optional')
    if (optional) {
      const plan = planSync({
        manifest,
        disabledOptional: new Set([optional.projectId]),
        local: await readLocalJars(modsDir),
        managed: await readManaged(modsDir),
      })
      await applySync({ modsDir, plan, download })
      const left = readdirSync(modsDir)
      console.log(
        `6. 任意の ${optional.title} を外す: 退避 ${plan.retire.join(', ')}・利用者の jar は残る=${left.includes('my-own-mod.jar')}`,
      )
    }

    const addons = new Addons(http, async () => undefined)
    const hits = await addons.search('shader', 'complementary', manifest.mcVersion)
    console.log(
      `7. シェーダー検索: ${hits
        .slice(0, 3)
        .map((h) => h.title)
        .join(' / ')}`,
    )
    const packs2 = await addons.search('resourcepack', 'faithful', manifest.mcVersion)
    const target = packs2[0]
    if (target) {
      const file = await addons.install('resourcepack', target.projectId, manifest.mcVersion, dir)
      await addons.setEnabled('resourcepack', dir, 'iris.properties', file, true)
      const listed = await addons.list('resourcepack', dir, 'iris.properties')
      console.log(
        `8. リソースパック: ${file} を入れて有効化 → ${JSON.stringify(listed.map((l) => [l.fileName, l.enabled]))}`,
      )
    }
    console.log('通し確認: すべて成功')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  console.error('失敗:', error instanceof Error ? error.message : error)
  process.exit(1)
})
