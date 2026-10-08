// 画面のファイルを app://launcher/ から配る（file:// に特別な権限を与えないため。Electron の推奨）。
// dist/renderer の外のファイルは返さない。
import path from 'node:path'

export const APP_ORIGIN = 'app://launcher'
export const APP_INDEX = `${APP_ORIGIN}/index.html`

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
}

/** 要求された URL を、rootDir の中のファイルのパスに変える。範囲外・不正なら null */
export function resolveAppRequest(
  url: string,
  rootDir: string,
): { file: string; type: string } | null {
  let parsed: URL
  let pathname: string
  try {
    parsed = new URL(url)
    pathname = decodeURIComponent(parsed.pathname)
  } catch {
    return null
  }
  if (parsed.protocol !== 'app:' || parsed.host !== 'launcher') return null
  if (pathname.includes('\0') || pathname.split(/[\\/]/).includes('..')) return null
  const root = path.resolve(rootDir)
  const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`)
  if (!file.startsWith(root + path.sep)) return null
  const type = TYPES[path.extname(file).toLowerCase()]
  return type ? { file, type } : null
}
