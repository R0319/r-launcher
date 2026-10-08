import { describe, expect, it } from 'vitest'
import { maskLog } from './mask'
describe('maskLog', () => {
  it('起動ログの秘密情報を消し、通常のログを保つ', () => {
    const lines = [
      '--accessToken secret --clientId client-secret --xuid 123456',
      'accessToken=abc xuid=345 Bearer bearer-secret',
      '{"accessToken":"json-secret"}',
      'Session ID is token:session-secret',
      'JWT eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature',
      'Discord AAAAAAAAAAAAAAAAAAAAAAAA.BBBBBB.CCCCCCCCCCCCCCCCCCCCCCCCCCC',
      'UUID 12345678-abcd-1234-abcd-123456789abc 12345678abcd1234abcd123456789abc',
      'Setting user: Steve',
      '--username Alex',
      'Chat: sTeVe said hello to Alex',
      'C:\\Users\\Alice\\AppData\\game /home/bob/game /Users/carol/game /custom/home/game',
      'Remote 192.168.1.12 [2001:db8::1234] ::ffff:192.168.1.1',
      'Local 127.0.0.1 0.0.0.0 ::1',
      'Email alice@example.com',
      'NeoForge 21.1.123 Minecraft 1.21.1',
      'at net.minecraft.client.main.Main.main(Main.java:123)',
      'Loading Mod sodium 0.6.0',
      'SteveExtra Alexandra',
    ]
    const ctx = { names: ['Steve', 'Alex'], homeDir: '/custom/home' }
    const result = maskLog(lines.join('\n'), ctx)
    for (const secret of [
      'secret',
      'eyJhb',
      'AAAAAAAA',
      '12345678',
      'Alice',
      'bob',
      'carol',
      '192.168',
      '2001:db8',
      'alice@example',
    ])
      expect(result.text).not.toContain(secret)
    for (const line of lines.slice(14)) expect(result.text).toContain(line)
    expect(result.text).toContain('Local 127.0.0.1 0.0.0.0 ::1')
    expect(result.counts).toEqual({
      token: 9,
      discord: 1,
      uuid: 2,
      player: 4,
      path: 4,
      ip: 3,
      email: 1,
    })
    expect(maskLog(result.text, ctx).text).toBe(result.text)
    expect(Object.values(maskLog(result.text, ctx).counts).every((n) => n === 0)).toBe(true)
  })
  it('名前の正規表現文字と単語境界を扱う', () => {
    expect(maskLog('A+B A+BX', { names: ['A+B'] }).text).toBe('<player> A+BX')
  })
})
