import React from 'react'
import ReactDOM from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import App from './App'
import './index.css'

const PUBLISHABLE_KEY =
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ||
  import.meta.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
  ''

if (!PUBLISHABLE_KEY) {
  console.warn(
    '[Clerk] Missing VITE_CLERK_PUBLISHABLE_KEY — auth UI will show a setup hint.',
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY || 'pk_test_placeholder'}
      afterSignOutUrl="#/landing"
    >
      <App />
    </ClerkProvider>
  </React.StrictMode>,
)
