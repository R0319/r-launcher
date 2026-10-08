import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { sha1, sha512, sha1File, sha512File } from './hash'
it('既知のハッシュとストリーム読み込み', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'launcher-hash-'))
  try {
    const bytes = Buffer.from('abc'),
      file = path.join(dir, 'data')
    await fs.writeFile(file, bytes)
    expect(sha1(bytes)).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
    expect(sha512(bytes)).toBe(
      'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    )
    expect(await sha1File(file)).toBe(sha1(bytes))
    expect(await sha512File(file)).toBe(sha512(bytes))
    await expect(sha1File(path.join(dir, 'missing'))).rejects.toThrow()
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
