// ランチャーとゲームのログ。直近の行をメモリに持ち、同じ内容をファイルにも書く。
// 画面に出すのは生のログ（この PC の中だけ）。コピー・保存するときにだけ mask.ts で隠す。
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import path from 'node:path'

const MAX_LINES = 5000
const MAX_LINE_LENGTH = 4000
const MAX_FILE_BYTES = 20 * 1024 * 1024

export class LogBuffer {
  private lines: string[] = []
  private listeners = new Set<(line: string) => void>()
  readonly file: string

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true })
    this.file = path.join(dir, 'latest.log')
    // 前回のログは previous.log に回す（2 世代だけ残す）
    if (existsSync(this.file)) renameSync(this.file, path.join(dir, 'previous.log'))
  }

  write(source: 'launcher' | 'game', text: string) {
    for (const raw of text.split(/\r?\n/)) {
      if (!raw.trim()) continue
      const line = `[${timestamp()}] [${source}] ${raw.slice(0, MAX_LINE_LENGTH)}`
      this.lines.push(line)
      if (this.lines.length > MAX_LINES) this.lines.splice(0, this.lines.length - MAX_LINES)
      this.toFile(line)
      for (const listener of this.listeners) listener(line)
    }
  }

  text(): string {
    return this.lines.join('\n')
  }

  onLine(listener: (line: string) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private toFile(line: string) {
    try {
      if (existsSync(this.file) && statSync(this.file).size > MAX_FILE_BYTES) return
      appendFileSync(this.file, `${line}\n`, 'utf-8')
    } catch {
      // ログが書けなくてもランチャーは止めない（画面のログには残る）
    }
  }
}

function timestamp() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
