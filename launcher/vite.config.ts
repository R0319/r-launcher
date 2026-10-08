import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 画面（renderer）だけを Vite で作る。main / preload は tsc。
// file:// で読むので base は相対にする。
export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react()],
  build: { outDir: '../../dist/renderer', emptyOutDir: true, target: 'chrome140' },
  server: { port: 5180, strictPort: true },
})
