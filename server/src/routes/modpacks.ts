import type { FastifyInstance } from 'fastify'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { listModpacks, getModpack, modpackDir } from '../modpackStore.js'
import { SIDE_DIRS } from '../manifestGen.js'
import type { Manifest } from '../types.js'

const PUBLIC_SUBDIRS = [SIDE_DIRS.required_both, SIDE_DIRS.client_required, SIDE_DIRS.client_optional]

export default async function modpacksRoute(app: FastifyInstance) {
  // 利用可能な modpack 一覧
  app.get('/modpacks', async () => {
    return { modpacks: await listModpacks() }
  })

  // 指定 modpack の manifest
  app.get<{ Params: { id: string } }>('/modpacks/:id/manifest', async (req, reply) => {
    const mp = await getModpack(req.params.id)
    if (!mp) return reply.status(404).send({ error: 'modpack_not_found' })
    try {
      const raw = await readFile(path.join(modpackDir(mp.id), 'manifest.json'), 'utf-8')
      return JSON.parse(raw) as Manifest
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { generatedAt: new Date(0).toISOString(), mods: [] } satisfies Manifest
      }
      app.log.error(err, 'manifest 読み込み失敗')
      return reply.status(500).send({ error: 'manifest_unavailable' })
    }
  })

  // 指定 modpack の MOD ファイル配信（required / client のみ公開）
  app.get<{ Params: { id: string; fileName: string } }>(
    '/modpacks/:id/mods/:fileName',
    async (req, reply) => {
      const { id, fileName } = req.params
      if (fileName !== path.basename(fileName)) {
        return reply.status(400).send({ error: 'invalid_file_name' })
      }
      const mp = await getModpack(id)
      if (!mp) return reply.status(404).send({ error: 'modpack_not_found' })

      for (const subdir of PUBLIC_SUBDIRS) {
        const filePath = path.join(modpackDir(id), subdir, fileName)
        try {
          const info = await stat(filePath)
          if (info.isFile()) {
            reply.header('Content-Type', 'application/java-archive')
            return reply.send(createReadStream(filePath))
          }
        } catch {
          /* 次を試す */
        }
      }
      return reply.status(404).send({ error: 'not_found' })
    },
  )
}
