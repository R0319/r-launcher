import { isIP } from 'node:net'
export type MaskKind = 'token' | 'uuid' | 'player' | 'path' | 'ip' | 'email' | 'discord'
export function maskLog(
  text: string,
  ctx?: { names?: string[]; homeDir?: string },
): { text: string; counts: Record<MaskKind, number> } {
  const counts: Record<MaskKind, number> = {
    token: 0,
    uuid: 0,
    player: 0,
    path: 0,
    ip: 0,
    email: 0,
    discord: 0,
  }
  const replace = (pattern: RegExp, kind: MaskKind, marker: string): void => {
    text = text.replace(pattern, () => {
      counts[kind]++
      return marker
    })
  }
  const valuePattern =
    /((?:--(?:accessToken|clientId|xuid)\s+|(?:accessToken|xuid)\s*=\s*|Bearer\s+|Session ID is token:))(?!(?:<token>))(?:"[^"\r\n]*"|[^\s,;"<>]+)/gi
  text = text.replace(valuePattern, (_match, prefix: string) => {
    counts.token++
    return `${prefix}<token>`
  })
  text = text.replace(
    /("accessToken"\s*:\s*")([^"\r\n]+)(")/gi,
    (match, prefix: string, value: string, suffix: string) => {
      if (value === '<token>') return match
      counts.token++
      return `${prefix}<token>${suffix}`
    },
  )
  replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, 'token', '<token>')
  replace(
    /\b(?:[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}|mfa\.[A-Za-z0-9_-]{80,})\b/g,
    'discord',
    '<token>',
  )
  replace(
    /\b(?:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|[a-f0-9]{32})\b/gi,
    'uuid',
    '<uuid>',
  )
  replace(
    /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}/gi,
    'email',
    '<email>',
  )
  const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (ctx?.homeDir)
    replace(
      new RegExp(`${escape(ctx.homeDir.replace(/[\\/]+$/, ''))}(?=[\\/\\s"']|$)`, 'gi'),
      'path',
      'C:\\Users\\<user>',
    )
  replace(
    /(?:[A-Z]:\\Users\\|\/home\/|\/Users\/)(?!<user>)[^\\/\s"'<>]+/gi,
    'path',
    'C:\\Users\\<user>',
  )
  text = text.replace(
    /((?:Setting user:\s*|--username\s+))([^\s"<>]+)/gi,
    (_match, prefix: string) => {
      counts.player++
      return `${prefix}<player>`
    },
  )
  for (const name of ctx?.names ?? [])
    if (name) {
      const pattern = new RegExp(
        `(?<![\\p{L}\\p{N}_<>])${escape(name)}(?![\\p{L}\\p{N}_<>])`,
        'giu',
      )
      replace(pattern, 'player', '<player>')
    }
  text = text.replace(
    /(?<![\w:])(?:[a-f0-9]*:){2,}[a-f0-9:.]*(?:%[\w.-]+)?|(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])/gi,
    (value) => {
      if (!isIP(value) || ['127.0.0.1', '0.0.0.0', '::1'].includes(value)) return value
      counts.ip++
      return '<ip>'
    },
  )
  return { text, counts }
}
