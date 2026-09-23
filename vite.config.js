import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import driverHandler from './api/driver.js'
import stripeHandler from './api/stripe-payment-methods.js'
import adminHandler from './api/admin-drivers.js'
import friendHandler from './api/friend-rides.js'
import carpoolHandler from './api/carpool.js'

const legacy = {
  '/api/help-chat': ['/api/admin-drivers?action=help-chat', adminHandler],
  '/api/support-chat': ['/api/admin-drivers?action=support-chat', adminHandler],
  '/api/support-ticket': ['/api/admin-drivers?action=ticket', adminHandler],
  '/api/driver-earnings': ['/api/driver?action=earnings', driverHandler],
  '/api/driver-signup': ['/api/driver?action=signup', driverHandler],
  '/api/driver-submit-review': ['/api/driver?action=submit-review', driverHandler],
  '/api/trip-offer-preview': ['/api/driver?action=offer-preview', driverHandler],
  '/api/trip-tip': ['/api/driver?action=tip', driverHandler],
  '/api/trip-wait': ['/api/driver?action=wait', driverHandler],
  '/api/trip-cancel-midride': ['/api/driver?action=cancel-midride', driverHandler],
  '/api/driver-payouts': ['/api/driver?action=payouts', driverHandler],
  '/api/quote-fare': ['/api/stripe-payment-methods?action=quote', stripeHandler],
  '/api/airport-checkout': ['/api/stripe-payment-methods?action=airport-checkout', stripeHandler],
  '/api/buy-credits': ['/api/stripe-payment-methods?action=buy-credits', stripeHandler],
  '/api/credits-confirm': ['/api/stripe-payment-methods?action=credits-confirm', stripeHandler],
  '/api/collect-payment': ['/api/stripe-payment-methods?action=collect', stripeHandler],
  '/api/trip-settle': ['/api/stripe-payment-methods?action=settle', stripeHandler],
}

const direct = {
  '/api/driver': driverHandler,
  '/api/admin-drivers': adminHandler,
  '/api/stripe-payment-methods': stripeHandler,
  '/api/friend-rides': friendHandler,
  '/api/carpool': carpoolHandler,
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Serve folded /api routers during `vite`, including legacy paths. */
function devApiPlugin() {
  return {
    name: 'clemson-dev-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url || '/'
        const path = rawUrl.split('?')[0]
        const mapped = legacy[path]
        const handler = mapped ? mapped[1] : direct[path]
        if (!handler) {
          next()
          return
        }
        if (mapped) {
          const q = rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?') + 1) : ''
          const dest = mapped[0]
          req.url = q ? `${dest}&${q}` : dest
        }
        try {
          const raw = await readBody(req)
          if (raw) {
            try { req.body = JSON.parse(raw) } catch { req.body = raw }
          } else if (req.body == null) {
            req.body = {}
          }
          await handler(req, res)
        } catch (error) {
          if (!res.headersSent) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: error?.message || 'API error' }))
          }
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), devApiPlugin()],
  build: {
    outDir: 'dist',
  },
})
