import type { LauncherManifest, ManifestMod } from '../shared/contract'
export interface LocalJar {
  fileName: string
  sha1: string
}
export interface IntegrityReport {
  verdict: 'ok' | 'warn' | 'block'
  missing: ManifestMod[]
  mismatched: Array<{ mod: ManifestMod; fileName: string }>
  extras: Array<{ fileName: string; allowed: boolean }>
}
export function checkIntegrity(input: {
  manifest: LauncherManifest
  disabledOptional: ReadonlySet<string>
  local: LocalJar[]
}): IntegrityReport {
  const { manifest, disabledOptional, local } = input
  const report: IntegrityReport = { verdict: 'ok', missing: [], mismatched: [], extras: [] }
  const recognized = new Set<LocalJar>()
  for (const mod of manifest.mods) {
    const matching = local.filter((jar) => jar.sha1.toLowerCase() === mod.sha1)
    const named = local.filter((jar) => jar.fileName === mod.fileName)
    for (const jar of [...matching, ...named]) recognized.add(jar)
    if (mod.side === 'optional' && disabledOptional.has(mod.projectId)) continue
    for (const jar of named)
      if (jar.sha1.toLowerCase() !== mod.sha1)
        report.mismatched.push({ mod, fileName: jar.fileName })
    if (!matching.length && !named.length && mod.side === 'required') report.missing.push(mod)
  }
  for (const jar of local)
    if (!recognized.has(jar))
      report.extras.push({
        fileName: jar.fileName,
        allowed:
          manifest.integrity.allowExtraMods ||
          manifest.integrity.allowedExtraPatterns.some((pattern) =>
            jar.fileName.toLowerCase().includes(pattern),
          ),
      })
  if (
    manifest.integrity.mode !== 'off' &&
    (report.missing.length || report.mismatched.length || report.extras.some((jar) => !jar.allowed))
  )
    report.verdict = manifest.integrity.mode
  return report
}
