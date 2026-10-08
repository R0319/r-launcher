function readArray(text: string, key: string): string[] {
  const line = text.split(/\r?\n/).find((line) => line.startsWith(`${key}:`))
  try {
    const value: unknown = JSON.parse(line?.slice(key.length + 1) ?? '[]')
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}
function update(text: string, values: Record<string, string>, separator: string): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const remaining = new Set(Object.keys(values))
  const lines = text.split(eol).map((line) => {
    const rawKey = line.slice(0, line.indexOf(separator))
    const key = separator === '=' ? rawKey.trim() : rawKey
    if (!Object.hasOwn(values, key) || !line.includes(separator)) return line
    remaining.delete(key)
    return `${rawKey}${separator}${values[key]}`
  })
  let result = lines.join(eol)
  for (const key of remaining) {
    if (result && !result.endsWith(eol)) result += eol
    result += `${key}${separator}${values[key]}${eol}`
  }
  return result
}
function validatePack(pack: string, resource: boolean): void {
  const name = resource ? pack.replace(/^file\//, '') : pack
  if (
    (resource && !pack.startsWith('file/')) ||
    !name ||
    /["\r\n\0/\\]/.test(name) ||
    name.includes('..')
  )
    throw new Error(`不正なパック名: ${pack}`)
}
export function readResourcePacks(optionsTxt: string): string[] {
  return readArray(optionsTxt, 'resourcePacks')
}
export function setResourcePacks(optionsTxt: string, enabled: string[]): string {
  enabled.forEach((pack) => validatePack(pack, true))
  const builtin = readResourcePacks(optionsTxt).filter((pack) => !pack.startsWith('file/'))
  return update(
    optionsTxt,
    {
      resourcePacks: JSON.stringify([...new Set([...builtin, ...enabled])]),
      incompatibleResourcePacks: JSON.stringify(
        readArray(optionsTxt, 'incompatibleResourcePacks').filter(
          (pack) => !enabled.includes(pack),
        ),
      ),
    },
    ':',
  )
}
export function readIrisShader(props: string): { enabled: boolean; pack: string | null } {
  const values = new Map(
    props
      .split(/\r?\n/)
      .filter((line) => !/^\s*[#!]/.test(line))
      .map((line) => {
        const i = line.indexOf('=')
        return [line.slice(0, i).trim(), line.slice(i + 1).trim()]
      }),
  )
  return { enabled: values.get('enableShaders') === 'true', pack: values.get('shaderPack') || null }
}
export function setIrisShader(props: string, pack: string | null): string {
  if (pack !== null) validatePack(pack, false)
  return update(props, { shaderPack: pack ?? '', enableShaders: String(pack !== null) }, '=')
}
