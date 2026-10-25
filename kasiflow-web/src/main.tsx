import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/bricolage-grotesque'
import '@fontsource-variable/public-sans'
import './index.css'
import { isConfigured } from '@/lib/env'
import { ConfigRequired } from '@/components/shared/ConfigRequired'
import { listenForInstallPrompt, registerServiceWorker } from '@/features/pwa/install'
import { App } from '@/app/App'

listenForInstallPrompt()
registerServiceWorker()

createRoot(document.getElementById('root')!).render(<StrictMode>{isConfigured ? <App /> : <ConfigRequired />}</StrictMode>)
