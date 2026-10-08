// 背景画像の取り込み。中身の先頭バイトで形式を確かめ、ハッシュ名でアプリのフォルダにコピーする。
// 画面からは rl-bg: スキームでこのフォルダの中のファイルだけを読める。
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const MAX_BACKGROUND_BYTES = 10 * 1024 * 1024
export const BACKGROUND_NAME = /^[0-9a-f]{64}\.(png|jpg|webp)$/

export function imageType(head: Uint8Array): 'png' | 'jpg' | 'webp' | null {
  const starts = (bytes: number[], offset = 0) => bytes.every((b, i) => head[offset + i] === b)
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (starts([0xff, 0xd8, 0xff])) return 'jpg'
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'webp'
  return null
}

/** 取り込んだファイル名を返す。画像でない・大きすぎるときは日本語の理由で失敗する */
export function importBackground(source: string, dir: string): string {
  const size = statSync(source).size
  if (size > MAX_BACKGROUND_BYTES) throw new Error('画像が大きすぎます（10MB まで）')
  const data = readFileSync(source)
  const type = imageType(data.subarray(0, 16))
  if (!type) throw new Error('PNG・JPEG・WebP の画像を選んでください')
  const name = `${createHash('sha256').update(data).digest('hex')}.${type}`
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, name), data)
  return name
}

/** rl-bg://image/<name> の要求を、フォルダ内のファイルのパスに変える（それ以外は null） */
export function resolveBackgroundRequest(url: string, dir: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'rl-bg:' || parsed.hostname !== 'image') return null
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  return BACKGROUND_NAME.test(name) ? path.join(dir, name) : null
}

export function backgroundUrl(name: string | null): string | null {
  return name && BACKGROUND_NAME.test(name) ? `rl-bg://image/${name}` : null
}
