import type { FastifyInstance } from 'fastify'
import { findPlayerByUuid } from '../db.js'

export default async function playerRoute(app: FastifyInstance) {
  app.get<{ Params: { uuid: string } }>('/player/:uuid', async (req, reply) => {
    const { uuid } = req.params
    const player = await findPlayerByUuid(uuid)
    // 登録有無だけ返す。Discord ID / MCID などの個人情報は無認証エンドポイントで返さない。
    return { registered: !!player }
  })
}
