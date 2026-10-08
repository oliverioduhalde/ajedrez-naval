import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { useGameStore } from './store/gameStore.ts'
import { initTheme } from './ui/theme.ts'

initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Dev helper — expose store on window
if (import.meta.env.DEV) {
  (window as any).__store = useGameStore;
}
