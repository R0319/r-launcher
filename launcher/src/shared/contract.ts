// mc-panel との契約（mc-panel の docs/launcher-api.md と対応）。Panel の応答は必ずここで検証してから使う。
import { z } from 'zod'

/** サーバー ID（mc-panel の ServerIdParamsSchema と同じ範囲） */
export const ServerIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/)

/** 接続先（ホスト名）。Minecraft の引数・servers.dat に入るので形を厳しく見る */
export const HostSchema = z
  .string()
  .max(253)
  .regex(/^(?![.-])[a-z0-9.-]+$/)

export const LoaderSchema = z.enum(['fabric', 'neoforge', 'forge'])
export type Loader = z.infer<typeof LoaderSchema>

export const ServerStateSchema = z.enum([
  'provisioning',
  'stopped',
  'starting',
  'running',
  'stopping',
  'error',
])
export type ServerState = z.infer<typeof ServerStateSchema>

export const PackSummarySchema = z.object({
  id: ServerIdSchema,
  name: z.string().min(1).max(100),
  mcVersion: z.string().regex(/^[0-9a-z.\-_ ]{1,40}$/i),
  loader: LoaderSchema,
  host: HostSchema,
  port: z.number().int().min(1).max(65535).default(25565),
  state: ServerStateSchema.default('stopped'),
  online: z
    .object({ players: z.number().int().nonnegative(), max: z.number().int().nonnegative() })
    .nullable()
    .default(null),
})
export type PackSummary = z.infer<typeof PackSummarySchema>

const Sha1 = z.string().regex(/^[0-9a-f]{40}$/)
const Sha512 = z.string().regex(/^[0-9a-f]{128}$/)
/** mods フォルダに置くファイル名。区切り文字や .. を含めない */
export const JarNameSchema = z
  .string()
  .max(200)
  .regex(/^[^/\\:*?"<>|\0]+\.jar$/)
  .refine((name) => !name.startsWith('.'), 'ドットで始まる名前は使えません')

export const ManifestModSchema = z.object({
  source: z.enum(['modrinth', 'curseforge']),
  projectId: z.string().min(1).max(64),
  slug: z.string().max(100),
  title: z.string().max(200),
  versionNumber: z.string().max(100),
  fileName: JarNameSchema,
  url: z.string().url(),
  sha1: Sha1,
  sha512: Sha512.optional(),
  size: z
    .number()
    .int()
    .nonnegative()
    .max(512 * 1024 * 1024),
  side: z.enum(['required', 'optional']),
})
export type ManifestMod = z.infer<typeof ManifestModSchema>

export const IntegrityPolicySchema = z.object({
  mode: z.enum(['off', 'warn', 'block']),
  allowExtraMods: z.boolean(),
  allowedExtraPatterns: z.array(z.string().regex(/^[a-z0-9._-]{2,40}$/)).max(50),
})
export type IntegrityPolicy = z.infer<typeof IntegrityPolicySchema>

export const LauncherManifestSchema = z.object({
  formatVersion: z.literal(1),
  id: ServerIdSchema,
  name: z.string().min(1).max(100),
  revision: z.string().max(40),
  mcVersion: z.string().regex(/^[0-9a-z.\-_ ]{1,40}$/i),
  loader: LoaderSchema,
  loaderVersion: z.string().regex(/^[0-9A-Za-z.+\-_]{1,60}$/),
  server: z.object({ host: HostSchema, port: z.number().int().min(1).max(65535) }),
  integrity: IntegrityPolicySchema,
  mods: z.array(ManifestModSchema).max(1000),
  serverOnly: z
    .array(z.object({ title: z.string().max(200), fileName: z.string().max(200) }))
    .max(1000)
    .default([]),
})
export type LauncherManifest = z.infer<typeof LauncherManifestSchema>

export const LinkStartSchema = z.object({
  linkId: z.string().regex(/^[A-Za-z0-9_-]{20,100}$/),
  serverId: z.string().regex(/^[0-9a-f]{1,20}$/),
  expiresAt: z.string(),
})
export const LinkVerifySchema = z.object({
  authorizeUrl: z.string().url(),
  current: z.object({ discordName: z.string().max(100) }).nullable().default(null),
})
export const LinkStatusSchema = z.object({
  state: z.enum(['pending', 'linked', 'expired']),
  discord: z.object({ id: z.string().max(30), name: z.string().max(100) }).optional(),
})
