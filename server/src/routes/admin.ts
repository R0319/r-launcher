import type { FastifyInstance } from 'fastify'
import { writeFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { verifyAdmin, verifyMaster, resolveMcid, normalizeUuid } from '../adminAuth.js'
import { listAdmins, addAdmin, removeAdmin } from '../adminStore.js'
import { config } from '../config.js'
import { regenerateManifest, SIDE_DIRS } from '../manifestGen.js'
import { searchMods, resolveInstallEntries } from '../modrinth.js'
import { addModrinthMods, removeModrinthMod } from '../modrinthStore.js'
import {
  listModpacks,
  getModpack,
  createModpack,
  updateModpack,
  deleteModpack,
  modpackDir,
  isValidModpackId,
} from '../modpackStore.js'
import type { LoaderType, ModSide } from '../types.js'

interface AdminCheckBody {
  msAccessToken: string
}
interface ModpackBody extends AdminCheckBody {
  modpackId: string
}
interface UploadBody extends ModpackBody {
  fileName: string
  side: ModSide
  dataBase64: string
}
interface DeleteBody extends ModpackBody {
  fileName: string
  side: ModSide
}
interface CreateModpackBody extends AdminCheckBody {
  id: string
  name: string
  loader: LoaderType
  mcVersion: string
  loaderVersion: string
  serverHost?: string
  serverPort?: number
  serverName?: string
}
interface UpdateModpackBody extends ModpackBody {
  name?: string
  loader?: LoaderType
  mcVersion?: string
  loaderVersion?: string
  serverHost?: string
  serverPort?: number
  serverName?: string
}

const VALID_SIDES: ModSide[] = ['required_both', 'client_required', 'client_optional', 'server_only']
const VALID_LOADERS: LoaderType[] = ['vanilla', 'neoforge', 'forge', 'fabric', 'quilt']

export default async function adminRoute(app: FastifyInstance) {
  // 管理者判定
  app.post<{ Body: AdminCheckBody }>('/admin/check', async (req, reply) => {
    const admin = await verifyAdmin(req.body?.msAccessToken ?? '')
    if (!admin) return reply.status(403).send({ isAdmin: false, isMaster: false })
    return { isAdmin: true, name: admin.name, uuid: admin.uuid, isMaster: admin.isMaster }
  })

  // --- 管理者アカウント管理（マスターのみ） ---
  // 管理者一覧（マスター＋動的管理者）
  app.post<{ Body: AdminCheckBody }>('/admin/admins', async (req, reply) => {
    const master = await verifyMaster(req.body?.msAccessToken ?? '')
    if (!master) return reply.status(403).send({ error: 'forbidden' })
    return {
      masters: config.masterUuids.map(normalizeUuid),
      admins: await listAdmins(),
    }
  })

  // Minecraft ID を指定して管理者を追加（マスターのみ）
  app.post<{ Body: AdminCheckBody & { mcid: string } }>('/admin/admins/add', async (req, reply) => {
    const master = await verifyMaster(req.body?.msAccessToken ?? '')
    if (!master) return reply.status(403).send({ error: 'forbidden' })
    const mcid = (req.body?.mcid ?? '').trim()
    if (!mcid) return reply.status(400).send({ error: 'missing_mcid' })

    const resolved = await resolveMcid(mcid)
    if (!resolved) return reply.status(404).send({ error: `Minecraft ID "${mcid}" が見つかりません` })

    // マスターは動的管理者に入れない（既に固定で管理者）。
    if (config.masterUuids.map(normalizeUuid).includes(resolved.uuid)) {
      return reply.status(409).send({ error: 'すでにマスター管理者です' })
    }
    const added = await addAdmin({
      uuid: resolved.uuid,
      mcid: resolved.name,
      addedBy: master.name,
      addedAt: new Date().toISOString(),
    })
    if (!added) return reply.status(409).send({ error: 'すでに管理者です' })

    app.log.info(`[admin] master ${master.name} added admin ${resolved.name} (${resolved.uuid})`)
    return { ok: true, added: { uuid: resolved.uuid, mcid: resolved.name }, admins: await listAdmins() }
  })

  // 管理者を削除（マスターのみ。マスター自身は削除不可）
  app.post<{ Body: AdminCheckBody & { uuid: string } }>('/admin/admins/remove', async (req, reply) => {
    const master = await verifyMaster(req.body?.msAccessToken ?? '')
    if (!master) return reply.status(403).send({ error: 'forbidden' })
    const uuid = normalizeUuid((req.body?.uuid ?? '').trim())
    if (!uuid) return reply.status(400).send({ error: 'missing_uuid' })
    if (config.masterUuids.map(normalizeUuid).includes(uuid)) {
      return reply.status(400).send({ error: 'マスター管理者は削除できません' })
    }
    const removed = await removeAdmin(uuid)
    if (!removed) return reply.status(404).send({ error: 'not_found' })
    app.log.info(`[admin] master ${master.name} removed admin ${uuid}`)
    return { ok: true, admins: await listAdmins() }
  })

  // modpack 一覧（管理用）
  app.post<{ Body: AdminCheckBody }>('/admin/modpacks', async (req, reply) => {
    const admin = await verifyAdmin(req.body?.msAccessToken ?? '')
    if (!admin) return reply.status(403).send({ error: 'forbidden' })
    return { modpacks: await listModpacks() }
  })

  // modpack 作成
  app.post<{ Body: CreateModpackBody }>('/admin/modpacks/create', async (req, reply) => {
    const { msAccessToken, id, name, loader, mcVersion, loaderVersion, serverHost, serverPort, serverName } =
      req.body ?? {}
    const admin = await verifyAdmin(msAccessToken)
    if (!admin) return reply.status(403).send({ error: 'forbidden' })
    if (!id || !name || !loader || !mcVersion) {
      return reply.status(400).send({ error: 'missing_params' })
    }
    if (!isValidModpackId(id)) return reply.status(400).send({ error: 'invalid_id' })
    if (!VALID_LOADERS.includes(loader)) return reply.status(400).send({ error: 'invalid_loader' })
    try {
      await createModpack({
        id,
        name,
        loader,
        mcVersion,
        loaderVersion: loaderVersion || 'latest',
        serverHost: serverHost || undefined,
        serverPort: serverPort || undefined,
        serverName: serverName || undefined,
      })
    } catch (err) {
      return reply.status(409).send({ error: (err as Error).message })
    }
    app.log.info(`[admin] ${admin.name} created modpack ${id}`)
    return { ok: true, modpacks: await listModpacks() }
  })

  // modpack 更新（バージョン・ローダー変更など）
  app.post<{ Body: UpdateModpackBody }>('/admin/modpacks/update', async (req, reply) => {
    const { msAccessToken, modpackId, ...patch } = req.body ?? ({} as UpdateModpackBody)
    const admin = await verifyAdmin(msAccessToken)
    if (!admin) return reply.status(403).send({ error: 'forbidden' })
    if (patch.loader && !VALID_LOADERS.includes(patch.loader)) {
      return reply.status(400).send({ error: 'invalid_loader' })
    }
    try {
      const updated = await updateModpack(modpackId, patch)
      app.log.info(`[admin] ${admin.name} updated modpack ${modpackId}`)
      return { ok: true, modpack: updated }
    } catch (err) {
      return reply.status(404).send({ error: (err as Error).message })
    }
  })

  // modpack 削除
  app.post<{ Body: ModpackBody }>('/admin/modpacks/delete', async (req, reply) => {
    const admin = await verifyAdmin(req.body?.msAccessToken ?? '')
    if (!admin) return reply.status(403).send({ error: 'forbidden' })
    await deleteModpack(req.body.modpackId)
    app.log.info(`[admin] ${admin.name} deleted modpack ${req.body.modpackId}`)
    return { ok: true, modpacks: await listModpacks() }
  })

  // 指定 modpack の MOD 一覧
  app.post<{ Body: ModpackBody }>('/admin/mods', async (req, reply) => {
    const admin = await verifyAdmin(req.body?.msAccessToken ?? '')
    if (!admin) return reply.status(403).send({ error: 'forbidden' })
    if (!(await getModpack(req.body.modpackId))) {
      return reply.status(404).send({ error: 'modpack_not_found' })
    }
    const manifest = await regenerateManifest(req.body.modpackId)
    return { mods: manifest.mods }
  })

  // MOD アップロード（指定 modpack）
  app.post<{ Body: UploadBody }>('/admin/upload', async (req, reply) => {
    const { msAccessToken, modpackId, fileName, side, dataBase64 } = req.body ?? {}
    const admin = await verifyAdmin(msAccessToken)
    if (!admin) return reply.status(403).send({ error: 'forbidden' })
    if (!modpackId || !fileName || !side || !dataBase64) {
      return reply.status(400).send({ error: 'missing_params' })
    }
    if (!(await getModpack(modpackId))) {
      return reply.status(404).send({ error: 'modpack_not_found' })
    }
    if (fileName !== path.basename(fileName) || !fileName.endsWith('.jar')) {
      return reply.status(400).send({ error: 'invalid_file_name' })
    }
    if (!VALID_SIDES.includes(side)) return reply.status(400).send({ error: 'invalid_side' })

    const destPath = path.join(modpackDir(modpackId), SIDE_DIRS[side], fileName)
    await writeFile(destPath, Buffer.from(dataBase64, 'base64'))
    const manifest = await regenerateManifest(modpackId)
    app.log.info(`[admin] ${admin.name} uploaded ${fileName} (${modpackId}/${side})`)
    return { ok: true, mods: manifest.mods }
  })

  // MOD 削除（指定 modpack）
  app.post<{ Body: DeleteBody }>('/admin/delete', async (req, reply) => {
    const { msAccessToken, modpackId, fileName, side } = req.body ?? {}
    const admin = await verifyAdmin(msAccessToken)
    if (!admin) return reply.status(403).send({ error: 'forbidden' })
    if (!modpackId || !fileName || fileName !== path.basename(fileName) || !VALID_SIDES.includes(side)) {
      return reply.status(400).send({ error: 'invalid_params' })
    }
    // Modrinth 経由（EC2 非保存・CDN配布）の MOD は modrinth.json から除去する。
    // 物理ファイルが無いため unlink は行わない。
    const removedFromCdn = await removeModrinthMod(modpackId, fileName)
    if (!removedFromCdn) {
      try {
        await unlink(path.join(modpackDir(modpackId), SIDE_DIRS[side], fileName))
      } catch {
        return reply.status(404).send({ error: 'not_found' })
      }
    }
    const manifest = await regenerateManifest(modpackId)
    app.log.info(`[admin] ${admin.name} deleted ${fileName} (${modpackId}/${side})`)
    return { ok: true, mods: manifest.mods }
  })

  // manifest 再生成（指定 modpack）
  app.post<{ Body: ModpackBody }>('/admin/regenerate', async (req, reply) => {
    const admin = await verifyAdmin(req.body?.msAccessToken ?? '')
    if (!admin) return reply.status(403).send({ error: 'forbidden' })
    const manifest = await regenerateManifest(req.body.modpackId)
    return { ok: true, count: manifest.mods.length, mods: manifest.mods }
  })

  // Modrinth 検索（対象 modpack のローダー/MCバージョンで絞り込み）
  app.post<{ Body: ModpackBody & { query: string } }>('/admin/modrinth/search', async (req, reply) => {
    const admin = await verifyAdmin(req.body?.msAccessToken ?? '')
    if (!admin) return reply.status(403).send({ error: 'forbidden' })
    const mp = await getModpack(req.body.modpackId)
    if (!mp) return reply.status(404).send({ error: 'modpack_not_found' })
    try {
      const hits = await searchMods(req.body.query ?? '', mp.loader, mp.mcVersion)
      return { hits }
    } catch (err) {
      return reply.status(502).send({ error: (err as Error).message })
    }
  })

  // Modrinth からワンクリック導入（必須依存も自動導入）
  app.post<{ Body: UploadBody & { projectId: string } }>(
    '/admin/modrinth/install',
    async (req, reply) => {
      const { msAccessToken, modpackId, projectId, side } = req.body ?? {}
      const admin = await verifyAdmin(msAccessToken)
      if (!admin) return reply.status(403).send({ error: 'forbidden' })
      const mp = await getModpack(modpackId)
      if (!mp) return reply.status(404).send({ error: 'modpack_not_found' })
      if (!projectId || !VALID_SIDES.includes(side)) {
        return reply.status(400).send({ error: 'invalid_params' })
      }
      try {
        // 本体＋必須依存を解決（EC2 には保存せず CDN URL を記録するだけ）。
        const entries = await resolveInstallEntries(projectId, mp.loader, mp.mcVersion, side)
        if (entries.length === 0) {
          return reply
            .status(409)
            .send({ error: `対象環境(${mp.loader} ${mp.mcVersion})に合う版が見つかりません` })
        }
        await addModrinthMods(modpackId, entries)
        const installed = entries.map((e) => e.fileName)
        const manifest = await regenerateManifest(modpackId)
        app.log.info(`[admin] ${admin.name} installed ${installed.join(', ')} from Modrinth (${modpackId})`)
        return { ok: true, installed, mods: manifest.mods }
      } catch (err) {
        return reply.status(502).send({ error: (err as Error).message })
      }
    },
  )
}
