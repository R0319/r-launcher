// EC2 上で MOD を手動更新した後に実行するスクリプト。
// 全 modpack の manifest.json を再生成する（実処理は src/manifestGen.ts に集約）。
import { regenerateManifest } from '../src/manifestGen.js'
import { listModpacks } from '../src/modpackStore.js'

async function main() {
  const modpacks = await listModpacks()
  if (modpacks.length === 0) {
    console.log('modpack がありません（mods_store/modpacks.json 未作成）')
    return
  }
  for (const mp of modpacks) {
    const manifest = await regenerateManifest(mp.id)
    console.log(`[${mp.id}] manifest 再生成（MOD数: ${manifest.mods.length}）`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
