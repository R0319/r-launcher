import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LauncherManifestSchema, type ManifestMod } from '../shared/contract'
import { sha1, sha512 } from './hash'
import { applySync, planSync, readLocalJars, readManaged } from './modSync'
let root: string, modsDir: string
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'launcher-sync-'))
  modsDir = path.join(root, 'mods')
  await fs.mkdir(modsDir)
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})
function mod(fileName: string, bytes = Buffer.from(fileName), optional = false): ManifestMod {
  return {
    source: 'modrinth',
    projectId: fileName,
    slug: '',
    title: fileName,
    versionNumber: '1',
    fileName,
    url: `https://cdn.modrinth.com/${fileName}`,
    sha1: sha1(bytes),
    sha512: sha512(bytes),
    size: bytes.length,
    side: optional ? 'optional' : 'required',
  }
}
function manifest(mods: ManifestMod[]) {
  return LauncherManifestSchema.parse({
    formatVersion: 1,
    id: 'server',
    name: 'Server',
    revision: '1',
    mcVersion: '1.21',
    loader: 'fabric',
    loaderVersion: '1',
    server: { host: 'localhost', port: 25565 },
    integrity: { mode: 'block', allowExtraMods: false, allowedExtraPatterns: [] },
    mods,
  })
}
const download = async (url: string): Promise<Buffer> => Buffer.from(new URL(url).pathname.slice(1))
async function plan(mods: ManifestMod[], disabledOptional = new Set<string>()) {
  return planSync({
    manifest: manifest(mods),
    disabledOptional,
    local: await readLocalJars(modsDir),
    managed: await readManaged(modsDir),
  })
}
describe('Mod同期', () => {
  it('新規導入、更新、ごみ箱、利用者のjar保護', async () => {
    await fs.writeFile(path.join(modsDir, 'user.jar'), 'user')
    const first = await applySync({ modsDir, plan: await plan([mod('a.jar')]), download })
    expect(first.installed).toEqual(['a.jar'])
    expect(await readManaged(modsDir)).toEqual(['a.jar'])
    const updated = mod('a.jar', Buffer.from('new'))
    const next = await plan([updated])
    expect(next.retire).toEqual(['a.jar'])
    expect(next.download).toEqual([updated])
    await applySync({
      modsDir,
      plan: next,
      download: async (_url, size) => {
        expect(size).toBe(3)
        return Buffer.from('new')
      },
      now: new Date('2026-01-01T00:00:00Z'),
    })
    expect(await fs.readFile(path.join(modsDir, 'a.jar'), 'utf8')).toBe('new')
    expect(await fs.readFile(path.join(modsDir, 'user.jar'), 'utf8')).toBe('user')
    const trashDirs = await fs.readdir(path.join(root, '.r-launcher-trash'))
    expect(
      await fs.readFile(path.join(root, '.r-launcher-trash', trashDirs[0]!, 'a.jar'), 'utf8'),
    ).toBe('a.jar')
    expect((await plan([updated])).keep).toEqual(['a.jar'])
  })
  it('optionalを外して戻す', async () => {
    const optional = mod('optional.jar', undefined, true)
    await applySync({ modsDir, plan: await plan([optional]), download })
    const disabled = await plan([optional], new Set([optional.projectId]))
    expect(disabled.retire).toEqual(['optional.jar'])
    expect(disabled.download).toEqual([])
    await applySync({ modsDir, plan: disabled, download })
    expect(await readManaged(modsDir)).toEqual([])
    await applySync({ modsDir, plan: await plan([optional]), download })
    expect(await readManaged(modsDir)).toEqual(['optional.jar'])
  })
  it('同一内容の別名の利用者jarは移動も管理対象への取り込みもしない', async () => {
    await fs.writeFile(path.join(modsDir, 'renamed.jar'), 'a.jar')
    expect(await plan([mod('a.jar')])).toEqual({ download: [], retire: [], keep: [] })
    await applySync({ modsDir, plan: await plan([mod('a.jar')]), download })
    expect(await readManaged(modsDir)).toEqual([])
  })
  it('ハッシュ不一致と途中の通信失敗で既存構成・managedを保つ', async () => {
    await applySync({ modsDir, plan: await plan([mod('a.jar')]), download })
    const record = await fs.readFile(path.join(modsDir, '.r-launcher-managed.json'), 'utf8')
    const updated = mod('a.jar', Buffer.from('new'))
    await expect(
      applySync({ modsDir, plan: await plan([updated]), download: async () => Buffer.from('bad') }),
    ).rejects.toThrow('ハッシュ')
    await expect(
      applySync({
        modsDir,
        plan: await plan([updated, mod('b.jar')]),
        download: async (url) => {
          if (url.endsWith('b.jar')) throw new Error('failure')
          return Buffer.from('new')
        },
      }),
    ).rejects.toThrow('failure')
    expect(await fs.readFile(path.join(modsDir, 'a.jar'), 'utf8')).toBe('a.jar')
    expect(await fs.readFile(path.join(modsDir, '.r-launcher-managed.json'), 'utf8')).toBe(record)
    expect((await fs.readdir(modsDir)).some((name) => name.startsWith('.r-launcher-stage'))).toBe(
      false,
    )
  })
  it('sha512も検証し、不正なパスと利用者jarの上書きを拒否', async () => {
    await expect(
      applySync({
        modsDir,
        plan: { download: [{ ...mod('a.jar'), sha512: '0'.repeat(128) }], retire: [], keep: [] },
        download,
      }),
    ).rejects.toThrow('ハッシュ')
    await expect(
      applySync({ modsDir, plan: { download: [], retire: ['../bad.jar'], keep: [] }, download }),
    ).rejects.toThrow()
    await fs.writeFile(path.join(modsDir, 'a.jar'), 'user')
    await expect(
      applySync({ modsDir, plan: await plan([mod('a.jar')]), download }),
    ).rejects.toThrow('利用者')
    expect(await fs.readFile(path.join(modsDir, 'a.jar'), 'utf8')).toBe('user')
  })
  it('配置途中の失敗もロールバックする', async () => {
    await applySync({ modsDir, plan: await plan([mod('a.jar')]), download })
    await fs.writeFile(
      path.join(modsDir, '.r-launcher-managed.json'),
      JSON.stringify(['a.jar', 'bad.jar']),
    )
    const record = await fs.readFile(path.join(modsDir, '.r-launcher-managed.json'), 'utf8')
    await fs.mkdir(path.join(modsDir, 'bad.jar'))
    await expect(
      applySync({
        modsDir,
        plan: { keep: [], retire: ['a.jar', 'bad.jar'], download: [] },
        download,
      }),
    ).rejects.toThrow('通常')
    expect(await fs.readFile(path.join(modsDir, 'a.jar'), 'utf8')).toBe('a.jar')
    expect(await fs.readFile(path.join(modsDir, '.r-launcher-managed.json'), 'utf8')).toBe(record)
  })
  it('誤った計画でも利用者のjarを退避しない', async () => {
    await fs.writeFile(path.join(modsDir, 'user.jar'), 'user')
    await expect(
      applySync({ modsDir, plan: { keep: [], retire: ['user.jar'], download: [] }, download }),
    ).rejects.toThrow('利用者')
    expect(await fs.readFile(path.join(modsDir, 'user.jar'), 'utf8')).toBe('user')
  })
  it('同時ダウンロードは4本まで、進捗は全件通知', async () => {
    let active = 0,
      maximum = 0
    const progress: number[] = []
    await applySync({
      modsDir,
      plan: await plan(Array.from({ length: 9 }, (_, i) => mod(`${i}.jar`))),
      download: async (url) => {
        active++
        maximum = Math.max(maximum, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active--
        return download(url)
      },
      onProgress: (p) => progress.push(p.done),
    })
    expect(maximum).toBe(4)
    expect(progress).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })
  it('欠落・壊れたmanagedと通常ファイルだけを読む', async () => {
    expect(await readManaged(modsDir)).toEqual([])
    await fs.writeFile(path.join(modsDir, '.r-launcher-managed.json'), 'broken')
    expect(await readManaged(modsDir)).toEqual([])
    await fs.writeFile(
      path.join(modsDir, '.r-launcher-managed.json'),
      JSON.stringify(['a.jar', '../bad.jar', 1]),
    )
    expect(await readManaged(modsDir)).toEqual(['a.jar'])
    await fs.mkdir(path.join(modsDir, 'dir.jar'))
    await fs.writeFile(path.join(modsDir, 'text.txt'), 'text')
    expect(await readLocalJars(modsDir)).toEqual([])
  })
})
