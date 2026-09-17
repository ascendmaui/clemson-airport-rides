import React from 'react'
import ReactDOM from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import App from './App'
import { clerkPublishableKey, isClerkConfigured } from './lib/clerkConfig'
import './index.css'

if (!isClerkConfigured) {
  console.warn(
    '[Clerk] Missing real VITE_CLERK_PUBLISHABLE_KEY — rendering without ClerkProvider so shells stay usable.',
  )
}

const tree = isClerkConfigured ? (
  <ClerkProvider publishableKey={clerkPublishableKey} afterSignOutUrl="#/landing">
    <App />
  </ClerkProvider>
) : (
  <App />
)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>{tree}</React.StrictMode>,
)
