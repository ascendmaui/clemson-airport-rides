/**
 * Process entry for the self-hosted Clemson RIDES server.
 * `node server/index.mjs` listens until SIGTERM or SIGINT.
 */
import http from 'node:http'
import { pathToFileURL } from 'node:url'
import { warnIfLiveAiOffline } from './llm.js'
import { createApp } from './selfHost.mjs'

const port = Number(process.env.PORT || 3000)
const host = process.env.HOST || '0.0.0.0'

export async function start() {
  warnIfLiveAiOffline()
  const listener = await createApp()
  const server = http.createServer(listener)
  const sockets = new Set()
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise((resolve) => {
    server.listen(port, host, resolve)
  })
  console.log(JSON.stringify({ level: 'info', msg: 'listening', host, port }))

  let closing = false
  function shutdown(signal) {
    if (closing) return
    closing = true
    console.log(JSON.stringify({ level: 'info', msg: 'shutdown', signal }))
    server.close(() => process.exit(0))
    setTimeout(() => {
      for (const socket of sockets) socket.destroy()
      process.exit(0)
    }, 10_000).unref()
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
  return server
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  start().catch((error) => {
    console.error(JSON.stringify({
      level: 'error',
      msg: 'startup_failed',
      error: error?.message || String(error),
    }))
    process.exit(1)
  })
}
