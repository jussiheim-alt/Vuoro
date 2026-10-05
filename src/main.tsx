import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { dismantleServiceWorkers } from './lib/swGuard'

// Stop legacy auto-updating service workers before React mounts.
void dismantleServiceWorkers()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
