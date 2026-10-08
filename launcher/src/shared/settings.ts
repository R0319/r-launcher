// 利用者の設定。保存時・読み込み時に必ずこのスキーマで検証する（壊れた値は既定に戻す）。
import { z } from 'zod'

export const ThemeSchema = z.enum(['system', 'light', 'dark'])
/** アクセントは決めた色の中から選ぶ（任意の CSS を入れさせない） */
export const AccentSchema = z.enum(['copper', 'grass', 'prismarine', 'redstone', 'gold'])
export type Accent = z.infer<typeof AccentSchema>

export const AppearanceSchema = z.object({
  theme: ThemeSchema.default('system'),
  accent: AccentSchema.default('copper'),
  /** 背景画像（アプリのデータフォルダに取り込んだファイル名）。null なら背景なし */
  background: z
    .string()
    .regex(/^[0-9a-f]{64}\.(png|jpg|webp)$/)
    .nullable()
    .default(null),
  /** 背景の暗さ（0〜80%）。文字を読みやすくする */
  backgroundDim: z.number().int().min(0).max(80).default(45),
})
export type Appearance = z.infer<typeof AppearanceSchema>

export const JavaSettingsSchema = z.object({
  /** auto: Minecraft の版に合う Java を自動で入れる / manual: 指定した java を使う */
  mode: z.enum(['auto', 'manual']).default('auto'),
  path: z.string().max(500).nullable().default(null),
  memoryMaxMb: z.number().int().min(1024).max(65536).default(4096),
  memoryMinMb: z.number().int().min(256).max(65536).default(1024),
  /** 追加の JVM 引数（1 行の文字列。起動時に検証して分割する） */
  jvmArgs: z.string().max(2000).default(''),
})
export type JavaSettings = z.infer<typeof JavaSettingsSchema>

export const SettingsSchema = z.object({
  panelUrl: z.string().max(200).default('https://panel.mc-shouchan.jp'),
  /** ゲームデータの親フォルダ（初回セットアップで決める） */
  instanceBaseDir: z.string().max(500).nullable().default(null),
  appearance: AppearanceSchema.default(AppearanceSchema.parse({})),
  java: JavaSettingsSchema.default(JavaSettingsSchema.parse({})),
  discordRichPresence: z.boolean().default(true),
  /** サーバーごとに「入れない」と選んだ任意 Mod（projectId の一覧） */
  disabledOptionalMods: z.record(z.string(), z.array(z.string().max(64)).max(1000)).default({}),
  selectedServerId: z.string().max(40).nullable().default(null),
})
export type Settings = z.infer<typeof SettingsSchema>

export function defaultSettings(): Settings {
  return SettingsSchema.parse({})
}

/** 保存データを読む。項目ごとに壊れていれば既定に戻す（全部を捨てない） */
export function parseSettings(raw: unknown): Settings {
  const full = SettingsSchema.safeParse(raw)
  if (full.success) return full.data
  const base = defaultSettings()
  if (!raw || typeof raw !== 'object') return base
  const result: Record<string, unknown> = { ...base }
  for (const key of Object.keys(SettingsSchema.shape) as Array<keyof Settings>) {
    const field = SettingsSchema.shape[key].safeParse((raw as Record<string, unknown>)[key])
    if (field.success) result[key] = field.data
  }
  return SettingsSchema.parse(result)
}
