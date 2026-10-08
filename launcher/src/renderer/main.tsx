import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { setApi } from './api'
import { App } from './App'
import './styles.css'

async function boot() {
  // Electron なしで画面だけ確かめるとき（npm run dev:renderer）は偽の本体を使う。配布版には入らない
  if (import.meta.env.DEV && !window.rLauncher) {
    const { createMockApi } = await import('./mockApi')
    const params = new URLSearchParams(location.search)
    setApi(
      createMockApi({
        setupCompleted: params.get('setup') !== '1',
        loggedIn: params.get('login') !== '0',
        integrity: (params.get('integrity') as 'warn' | 'block' | null) ?? 'ok',
        playDelayMs: 1500,
      }),
    )
  }
  const root = document.getElementById('root')
  if (!root) throw new Error('#root がありません')
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void boot()
