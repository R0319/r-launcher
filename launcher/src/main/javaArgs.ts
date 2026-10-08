export function parseJvmArgs(
  input: string,
): { ok: true; args: string[] } | { ok: false; error: string } {
  const fail = (word: string, reason: string): { ok: false; error: string } => ({
    ok: false,
    error: `引数「${word}」: ${reason}`,
  })
  if (/[\r\n\0]/.test(input)) return fail(input, '改行・NUL は使えません')
  const args: string[] = []
  let word = '',
    quoted = false,
    started = false
  for (const char of input) {
    if (char === '"') {
      quoted = !quoted
      started = true
    } else if (/\s/.test(char) && !quoted) {
      if (started) args.push(word)
      word = ''
      started = false
    } else {
      word += char
      started = true
    }
  }
  if (quoted) return fail(word, 'ダブルクォートが閉じていません')
  if (started) args.push(word)
  if (args.length > 64) return fail(args[64] ?? '', '引数は64個までです')
  for (const arg of args) {
    if (!arg.startsWith('-')) return fail(arg, '- で始めてください')
    if (arg.length > 500) return fail(arg, '500文字を超えています')
    if (/^-(?:Xmx|Xms|XX:MaxRAM)/i.test(arg)) return fail(arg, 'メモリは設定欄で指定してください')
    if (
      /^(?:-jar|-cp|-classpath|--class-path)(?:$|=)|^-(?:javaagent|agentlib|agentpath)(?:$|[:=])|^-Djava\.class\.path(?:$|=)/i.test(
        arg,
      )
    )
      return fail(arg, '起動先やエージェントは指定できません')
  }
  return { ok: true, args }
}
export function memoryPlan(totalMb: number): { maxAllowedMb: number; recommendedMb: number } {
  const total = Number.isFinite(totalMb) && totalMb > 0 ? totalMb : 3072
  const maxAllowedMb = Math.max(1024, Math.floor(total - 2048))
  return {
    maxAllowedMb,
    recommendedMb: Math.min(maxAllowedMb, Math.max(4096, Math.min(8192, Math.floor(total / 2)))),
  }
}
export function validateMemory(minMb: number, maxMb: number, totalMb: number): string | null {
  if (!Number.isFinite(totalMb) || totalMb <= 0) return '総メモリが不正です'
  if (!Number.isInteger(minMb) || minMb < 256 || minMb > 65536)
    return '最小メモリは256〜65536MBの整数にしてください'
  if (!Number.isInteger(maxMb) || maxMb < 1024 || maxMb > 65536)
    return '最大メモリは1024〜65536MBの整数にしてください'
  if (minMb > maxMb) return '最小メモリが最大メモリを超えています'
  if (maxMb > memoryPlan(totalMb).maxAllowedMb) return 'OS用に2048MBを残す範囲で指定してください'
  return null
}
