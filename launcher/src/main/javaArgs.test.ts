import { describe, expect, it } from 'vitest'
import { parseJvmArgs, memoryPlan, validateMemory } from './javaArgs'
describe('JVM引数', () => {
  it('空白と引用符', () => {
    expect(parseJvmArgs('-XX:+UseG1GC "-Dname=hello world"')).toEqual({
      ok: true,
      args: ['-XX:+UseG1GC', '-Dname=hello world'],
    })
    expect(parseJvmArgs('')).toEqual({ ok: true, args: [] })
  })
  it.each([
    'word',
    '-Xmx4G',
    '-Xms1G',
    '-XX:MaxRAMPercentage=80',
    '-jar',
    '-cp',
    '-classpath',
    '--class-path=x',
    '-javaagent:x',
    '-agentlib:x',
    '-agentpath:x',
    '-Djava.class.path=x',
    '-Dfoo=\n',
    '-Dfoo=\0',
    '"-Dfoo=x',
    '-' + 'x'.repeat(500),
    Array(65).fill('-Dx=y').join(' '),
  ])('危険な引数を拒否: %s', (arg) => {
    const result = parseJvmArgs(arg)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/引数「/)
  })
  it('個数と長さの境界', () => {
    expect(parseJvmArgs(Array(64).fill('-Dx=y').join(' ')).ok).toBe(true)
    expect(parseJvmArgs('-' + 'x'.repeat(499)).ok).toBe(true)
  })
})
describe('メモリ', () => {
  it('OS用の領域と推奨値', () => {
    expect(memoryPlan(16384)).toEqual({ maxAllowedMb: 14336, recommendedMb: 8192 })
    expect(memoryPlan(8192).recommendedMb).toBe(4096)
    expect(memoryPlan(2048)).toEqual({ maxAllowedMb: 1024, recommendedMb: 1024 })
  })
  it('設定の検証', () => {
    expect(validateMemory(1024, 4096, 8192)).toBeNull()
    for (const values of [
      [0, 4096, 8192],
      [4096, 1024, 8192],
      [1024, 8192, 8192],
      [256, NaN, 8192],
      [256, 1024, NaN],
    ])
      expect(validateMemory(values[0]!, values[1]!, values[2]!)).toBeTypeOf('string')
  })
})
