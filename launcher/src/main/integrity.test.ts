import { describe, expect, it } from 'vitest'
import { LauncherManifestSchema, type ManifestMod } from '../shared/contract'
import { checkIntegrity } from './integrity'
const mod: ManifestMod = {
  source: 'modrinth',
  projectId: 'a',
  slug: 'a',
  title: 'A',
  versionNumber: '1',
  fileName: 'a.jar',
  url: 'https://cdn.modrinth.com/a',
  sha1: 'a'.repeat(40),
  size: 1,
  side: 'required',
}
function manifest(
  mods: ManifestMod[],
  mode: 'off' | 'warn' | 'block' = 'block',
  allowExtraMods = false,
) {
  return LauncherManifestSchema.parse({
    formatVersion: 1,
    id: 'server',
    name: 'Server',
    revision: '1',
    mcVersion: '1.21',
    loader: 'fabric',
    loaderVersion: '1',
    server: { host: 'localhost', port: 25565 },
    integrity: { mode, allowExtraMods, allowedExtraPatterns: ['sodium'] },
    mods,
  })
}
describe('構成チェック', () => {
  it('別名の正常jarがあっても同名の破損jarを検出する', () => {
    const report = checkIntegrity({
      manifest: manifest([mod]),
      disabledOptional: new Set(),
      local: [
        { fileName: 'renamed.jar', sha1: mod.sha1 },
        { fileName: mod.fileName, sha1: 'b'.repeat(40) },
      ],
    })
    expect(report.missing).toEqual([])
    expect(report.mismatched).toEqual([{ mod, fileName: mod.fileName }])
    expect(report.verdict).toBe('block')
  })
  it('名前が違ってもハッシュで一致する', () =>
    expect(
      checkIntegrity({
        manifest: manifest([mod]),
        disabledOptional: new Set(),
        local: [{ fileName: 'renamed.jar', sha1: mod.sha1 }],
      }),
    ).toEqual({ verdict: 'ok', missing: [], mismatched: [], extras: [] }))
  it.each(['off', 'warn', 'block'] as const)('各modeで不足・不一致・余分を報告 %s', (mode) => {
    const report = checkIntegrity({
      manifest: manifest(
        [mod, { ...mod, projectId: 'b', fileName: 'b.jar', sha1: 'b'.repeat(40) }],
        mode,
      ),
      disabledOptional: new Set(),
      local: [
        { fileName: 'a.jar', sha1: 'c'.repeat(40) },
        { fileName: 'extra.jar', sha1: 'd'.repeat(40) },
      ],
    })
    expect(report.verdict).toBe(mode === 'off' ? 'ok' : mode)
    expect(report.missing).toHaveLength(1)
    expect(report.mismatched).toEqual([{ mod, fileName: 'a.jar' }])
    expect(report.extras).toEqual([{ fileName: 'extra.jar', allowed: false }])
  })
  it('optionalの不足は許容し、不一致は検出、無効化済みは無視する', () => {
    const optional = { ...mod, side: 'optional' as const }
    expect(
      checkIntegrity({ manifest: manifest([optional]), disabledOptional: new Set(), local: [] })
        .verdict,
    ).toBe('ok')
    const input = {
      manifest: manifest([optional]),
      local: [{ fileName: mod.fileName, sha1: 'b'.repeat(40) }],
    }
    expect(checkIntegrity({ ...input, disabledOptional: new Set() }).verdict).toBe('block')
    expect(checkIntegrity({ ...input, disabledOptional: new Set(['a']) })).toEqual({
      verdict: 'ok',
      missing: [],
      mismatched: [],
      extras: [],
    })
  })
  it('許可パターンは小文字の部分一致、全許可も扱う', () => {
    const local = [{ fileName: 'SODIUM-client.jar', sha1: 'b'.repeat(40) }]
    expect(
      checkIntegrity({ manifest: manifest([]), disabledOptional: new Set(), local }).extras[0]
        ?.allowed,
    ).toBe(true)
    expect(
      checkIntegrity({
        manifest: manifest([], 'block', true),
        disabledOptional: new Set(),
        local: [{ fileName: 'other.jar', sha1: 'c'.repeat(40) }],
      }).verdict,
    ).toBe('ok')
  })
})
