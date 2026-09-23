import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import helpChat from './api/help-chat.js'
import supportChat from './api/support-chat.js'
import supportTicket from './api/support-ticket.js'

const devApis = {
  '/api/help-chat': helpChat,
  '/api/support-chat': supportChat,
  '/api/support-ticket': supportTicket,
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Serve the Vercel /api handlers during `vite` so Help and Support work locally. */
function devApiPlugin() {
  return {
    name: 'clemson-dev-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = (req.url || '').split('?')[0]
        const handler = devApis[path]
        if (!handler) {
          next()
          return
        }
        try {
          const raw = await readBody(req)
          if (raw) {
            try { req.body = JSON.parse(raw) } catch { req.body = raw }
          } else {
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
