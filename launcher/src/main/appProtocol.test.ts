import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveAppRequest } from './appProtocol'

const root = path.resolve('dist-test-root')

describe('resolveAppRequest', () => {
  it('serves files inside the renderer folder with a fixed content type', () => {
    expect(resolveAppRequest('app://launcher/index.html', root)).toEqual({
      file: path.join(root, 'index.html'),
      type: 'text/html; charset=utf-8',
    })
    expect(resolveAppRequest('app://launcher/', root)?.file).toBe(path.join(root, 'index.html'))
    expect(resolveAppRequest('app://launcher/assets/index-abc.js', root)?.type).toContain(
      'javascript',
    )
  })

  it('refuses other hosts, traversal, encoded traversal and unknown types', () => {
    for (const url of [
      'app://other/index.html',
      'app://launcher/../package.json',
      'app://launcher/%2e%2e/package.json',
      'app://launcher/assets/..%5C..%5Cpackage.json',
      'app://launcher/a%00.js',
      'app://launcher/%E0%A4%A',
      'app://launcher/secret.json',
      'file:///C:/Windows/win.ini',
    ]) {
      expect(resolveAppRequest(url, root), url).toBeNull()
    }
  })
})
