import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

export const sha1 = (buf: Buffer): string => createHash('sha1').update(buf).digest('hex')
export const sha512 = (buf: Buffer): string => createHash('sha512').update(buf).digest('hex')
async function hashFile(path: string, algorithm: string): Promise<string> {
  const hash = createHash(algorithm)
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}
export const sha1File = (path: string): Promise<string> => hashFile(path, 'sha1')
export const sha512File = (path: string): Promise<string> => hashFile(path, 'sha512')
