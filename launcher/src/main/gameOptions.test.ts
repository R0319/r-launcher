import { describe, expect, it } from 'vitest'
import { readResourcePacks, setResourcePacks, readIrisShader, setIrisShader } from './gameOptions'
describe('ゲーム設定', () => {
  it('空白を含むpropertiesのキーも更新する', () => {
    const text = ' shaderPack =old.zip\nenableShaders =false\n#shaderPack=comment\n'
    expect(readIrisShader(setIrisShader(text, 'new.zip'))).toEqual({
      enabled: true,
      pack: 'new.zip',
    })
    expect(setIrisShader(text, 'new.zip')).toContain('#shaderPack=comment')
  })
  it('組み込み、順番、互換性、他の行を保つ', () => {
    const text =
      'gamma:0.5\nresourcePacks:["vanilla","fabric","mod_resources","file/old.zip"]\nincompatibleResourcePacks:["file/a.zip","file/b.zip"]\nother: untouched  \n'
    expect(setResourcePacks(text, ['file/a.zip'])).toBe(
      'gamma:0.5\nresourcePacks:["vanilla","fabric","mod_resources","file/a.zip"]\nincompatibleResourcePacks:["file/b.zip"]\nother: untouched  \n',
    )
  })
  it('CRLFと壊れた行、欠落行', () => {
    expect(readResourcePacks('resourcePacks:broken')).toEqual([])
    expect(setResourcePacks('gamma:1\r\n', ['file/a.zip'])).toBe(
      'gamma:1\r\nresourcePacks:["file/a.zip"]\r\nincompatibleResourcePacks:[]\r\n',
    )
    expect(readResourcePacks('resourcePacks:["vanilla",1]')).toEqual(['vanilla'])
  })
  it.each([
    'file/../x.zip',
    'file/a/b.zip',
    'file/a\\b.zip',
    'file/a"b.zip',
    'file/a\nb.zip',
    'bad.zip',
    'file/',
  ])('不正な名前 %s', (name) => expect(() => setResourcePacks('', [name])).toThrow())
  it('IrisとOculusの設定', () => {
    const text = '# comment\r\nshaderPack=old.zip\r\nenableShaders=false\r\nother = preserve\r\n'
    const result = setIrisShader(text, 'new.zip')
    expect(result).toBe(
      '# comment\r\nshaderPack=new.zip\r\nenableShaders=true\r\nother = preserve\r\n',
    )
    expect(readIrisShader(result)).toEqual({ enabled: true, pack: 'new.zip' })
    expect(readIrisShader(setIrisShader(result, null))).toEqual({ enabled: false, pack: null })
    expect(() => setIrisShader('', '../bad')).toThrow()
    expect(readIrisShader('bad')).toEqual({ enabled: false, pack: null })
  })
})
