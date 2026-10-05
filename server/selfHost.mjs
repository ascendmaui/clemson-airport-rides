/**
 * Production HTTP server for the Vite SPA and the Vercel-style api/*.js handlers.
 * Rewrites are read from vercel.json so the self-hosted routes stay aligned with it.
 */
import { createReadStream, readFileSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BODY_LIMIT = 1_000_000

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

function headerValue(req, name) {
  const headers = req?.headers || {}
  const want = name.toLowerCase()
  const direct = headers[want] ?? headers[name]
  if (Array.isArray(direct)) return direct[0] == null ? '' : String(direct[0])
  if (direct != null) return String(direct)
  return ''
}

export function parseCookies(cookieHeader) {
  const out = {}
  const raw = String(cookieHeader || '')
  if (!raw) return out
  for (const part of raw.split(';')) {
    const i = part.indexOf('=')
    if (i === -1) continue
    const key = part.slice(0, i).trim()
    if (!key) continue
    const value = part.slice(i + 1).trim()
    try {
      out[key] = decodeURIComponent(value)
    } catch {
      out[key] = value
    }
  }
  return out
}

export function queryFromSearch(search) {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const query = {}
  for (const key of params.keys()) {
    if (Object.prototype.hasOwnProperty.call(query, key)) continue
    const all = params.getAll(key)
    query[key] = all.length > 1 ? all : all[0]
  }
  return query
}

/** Compile one vercel.json rewrite source. Supports :name and regex groups. */
export function compileRewriteSource(source) {
  let regex = ''
  const names = []
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    if (ch === ':') {
      const match = /^:([A-Za-z0-9_]+)/.exec(source.slice(i))
      if (match) {
        names.push(match[1])
        regex += '([^/]+)'
        i += match[0].length
        continue
      }
    }
    if (ch === '(') {
      let depth = 0
      let j = i
      for (; j < source.length; j += 1) {
        if (source[j] === '(') depth += 1
        else if (source[j] === ')') {
          depth -= 1
          if (depth === 0) {
            j += 1
            break
          }
        }
      }
      regex += source.slice(i, j)
      i = j
      continue
    }
    if ('\\^$|?*+[]{}.'.includes(ch)) regex += `\\${ch}`
    else regex += ch
    i += 1
  }
  return { regex: new RegExp(`^${regex}$`), names }
}

export function loadRewrites(vercelPath) {
  const raw = JSON.parse(readFileSync(vercelPath, 'utf8'))
  const list = Array.isArray(raw.rewrites) ? raw.rewrites : []
  return list.map((rule) => ({
    source: rule.source,
    destination: rule.destination,
    ...compileRewriteSource(rule.source),
  }))
}

function fillDestination(destination, match, names) {
  let dest = destination
  for (let i = 0; i < names.length; i += 1) {
    dest = dest.split(`:${names[i]}`).join(match[i + 1] ?? '')
  }
  for (let i = match.length - 1; i >= 1; i -= 1) {
    dest = dest.split(`$${i}`).join(match[i] ?? '')
  }
  return dest
}

/**
 * Apply the first matching vercel.json rewrite.
 * Returns the destination pathname and search (leading ? or '').
 * Original query keys are kept when the destination did not set them.
 */
export function applyRewrites(pathname, search, rules) {
  for (const rule of rules) {
    const match = rule.regex.exec(pathname)
    if (!match) continue
    const filled = fillDestination(rule.destination, match, rule.names)
    const dest = new URL(filled, 'http://localhost')
    const incoming = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
    for (const [key, value] of incoming) {
      if (!dest.searchParams.has(key)) dest.searchParams.append(key, value)
    }
    const nextSearch = dest.searchParams.toString()
    return {
      pathname: dest.pathname,
      search: nextSearch ? `?${nextSearch}` : '',
      matched: true,
    }
  }
  return { pathname, search: search ? (search.startsWith('?') ? search : `?${search}`) : '', matched: false }
}

export async function discoverApiRoutes(apiDir) {
  const entries = await readdir(apiDir)
  const routes = new Map()
  const files = entries.filter((name) => name.endsWith('.js') && !name.endsWith('.test.js')).sort()
  for (const file of files) {
    const mod = await import(pathToFileURL(path.join(apiDir, file)).href)
    if (typeof mod.default !== 'function') continue
    const routePath = `/api/${file.slice(0, -3)}`
    const rawBody = mod.config?.api?.bodyParser === false
    routes.set(routePath, { file, handler: mod.default, rawBody })
  }
  return routes
}

function decorateRes(res) {
  if (typeof res.status === 'function') return res
  res.status = (code) => {
    res.statusCode = code
    return res
  }
  res.json = (body) => {
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(body ?? null))
    return res
  }
  res.send = (body) => {
    if (body == null) {
      res.end()
      return res
    }
    if (Buffer.isBuffer(body) || typeof body === 'string') {
      res.end(body)
      return res
    }
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(body))
    return res
  }
  res.redirect = (statusOrUrl, maybeUrl) => {
    const status = typeof statusOrUrl === 'number' ? statusOrUrl : 302
    const location = typeof statusOrUrl === 'number' ? maybeUrl : statusOrUrl
    res.statusCode = status
    res.setHeader('Location', location)
    res.end()
    return res
  }
  return res
}

function trustProxy(req) {
  const forwarded = headerValue(req, 'x-forwarded-for')
  req.ip = forwarded ? forwarded.split(',')[0].trim() : (req.socket?.remoteAddress || '')
  const proto = headerValue(req, 'x-forwarded-proto')
  if (proto) req.protocol = proto.split(',')[0].trim()
  const host = headerValue(req, 'x-forwarded-host') || headerValue(req, 'host')
  if (host) req.hostname = host.split(',')[0].trim().replace(/:\d+$/, '')
}

function isApiPath(pathname) {
  return pathname === '/api' || pathname.startsWith('/api/')
}

function normalizePath(pathname) {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1)
  return pathname
}

function readBody(req, limit = BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    req.on('data', (chunk) => {
      total += chunk.length
      if (total > limit) {
        const error = new Error('Payload too large')
        error.statusCode = 413
        reject(error)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function looksLikeJson(text) {
  const trimmed = text.trim()
  return trimmed.startsWith('{') || trimmed.startsWith('[')
}

async function assignParsedBody(req) {
  const buf = await readBody(req)
  if (!buf.length) {
    req.body = {}
    return
  }
  const type = headerValue(req, 'content-type')
  const text = buf.toString('utf8')
  if (type.includes('application/json') || type.includes('+json') || (!type && looksLikeJson(text))) {
    try {
      req.body = JSON.parse(text)
    } catch {
      req.body = text
    }
    return
  }
  if (type.includes('application/x-www-form-urlencoded')) {
    req.body = queryFromSearch(text)
    return
  }
  req.body = text
}

function sendJson(res, status, body) {
  if (res.writableEnded) return
  res.statusCode = status
  if (!res.headersSent) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
  }
  res.end(JSON.stringify(body))
}

function healthPayload() {
  return {
    ok: true,
    sha: process.env.GIT_SHA || process.env.SOURCE_COMMIT || 'unknown',
    uptime: Math.round(process.uptime()),
  }
}

function cacheControlFor(pathname) {
  if (pathname === '/' || pathname === '/index.html' || pathname.endsWith('/index.html')) {
    return 'no-cache'
  }
  if (pathname.startsWith('/assets/')) return 'public, max-age=31536000, immutable'
  return 'public, max-age=3600'
}

function safeStaticPath(distDir, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const root = path.resolve(distDir)
  const file = path.resolve(root, rel)
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) return null
  return file
}

async function serveFile(req, res, file, pathname) {
  let info
  try {
    info = await stat(file)
  } catch {
    return false
  }
  if (!info.isFile()) return false
  const ext = path.extname(file).toLowerCase()
  res.statusCode = 200
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream')
  res.setHeader('Cache-Control', cacheControlFor(pathname))
  res.setHeader('Content-Length', String(info.size))
  if (req.method === 'HEAD') {
    res.end()
    return true
  }
  await new Promise((resolve, reject) => {
    const stream = createReadStream(file)
    stream.on('error', reject)
    res.on('finish', resolve)
    stream.pipe(res)
  })
  return true
}

async function serveSpa(req, res, distDir) {
  const file = safeStaticPath(distDir, '/index.html')
  if (!file) {
    sendJson(res, 500, { error: 'index.html is missing from the build' })
    return
  }
  try {
    const info = await stat(file)
    if (!info.isFile()) throw new Error('index.html is not a file')
  } catch {
    sendJson(res, 500, { error: 'index.html is missing from the build' })
    return
  }
  const html = await readFile(file)
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Content-Length', String(html.length))
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  res.end(html)
}

export async function createApp(options = {}) {
  const root = options.root || REPO_ROOT
  const apiDir = options.apiDir || path.join(root, 'api')
  const distDir = options.distDir || path.join(root, 'dist')
  const vercelPath = options.vercelPath || path.join(root, 'vercel.json')
  const routes = options.routes || await discoverApiRoutes(apiDir)
  const rewrites = options.rewrites || loadRewrites(vercelPath)
  const log = options.log || ((entry) => {
    console.log(JSON.stringify(entry))
  })

  return async function onRequest(req, res) {
    const started = process.hrtime.bigint()
    decorateRes(res)
    const finishLog = () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6
      const pathOnly = String(req.url || '/').split('?')[0]
      log({
        time: new Date().toISOString(),
        level: 'info',
        msg: 'request',
        method: req.method,
        path: pathOnly,
        status: res.statusCode || 0,
        ms: Math.round(ms * 10) / 10,
      })
    }
    res.on('finish', finishLog)
    try {
      await dispatch(req, res, { routes, rewrites, distDir })
    } catch (error) {
      log({
        time: new Date().toISOString(),
        level: 'error',
        msg: 'request_error',
        method: req.method,
        path: String(req.url || '/').split('?')[0],
        error: error?.message || String(error),
      })
      if (!res.headersSent && !res.writableEnded) {
        sendJson(res, error?.statusCode || 500, { error: error?.statusCode === 413 ? 'Payload too large' : 'Internal error' })
      } else if (!res.writableEnded) {
        try { res.end() } catch { /* the handler already closed the stream */ }
      }
    }
  }
}

async function dispatch(req, res, { routes, rewrites, distDir }) {
  trustProxy(req)
  const original = new URL(req.url || '/', 'http://localhost')
  req.originalUrl = req.url || '/'
  req.cookies = parseCookies(headerValue(req, 'cookie'))

  const originalPath = original.pathname
  if (normalizePath(originalPath) === '/api/healthz') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD')
      sendJson(res, 405, { error: 'Method not allowed' })
      return
    }
    sendJson(res, 200, healthPayload())
    return
  }

  if (!isApiPath(originalPath) && (req.method === 'GET' || req.method === 'HEAD')) {
    const file = safeStaticPath(distDir, originalPath)
    if (file && await serveFile(req, res, file, originalPath)) return
  }

  let pathname = originalPath
  let search = original.search
  if (isApiPath(originalPath)) {
    const rewritten = applyRewrites(pathname, search, rewrites.filter((rule) => rule.source.startsWith('/api')))
    pathname = rewritten.pathname
    search = rewritten.search
  } else {
    const rewritten = applyRewrites(pathname, search, rewrites)
    if (!isApiPath(rewritten.pathname)) {
      pathname = rewritten.pathname
      search = rewritten.search
    }
  }

  const apiPath = normalizePath(pathname)
  if (isApiPath(originalPath) || isApiPath(apiPath)) {
    if (apiPath === '/api/healthz') {
      sendJson(res, 200, healthPayload())
      return
    }
    const route = routes.get(apiPath)
    if (!route) {
      sendJson(res, 404, { error: 'Not found' })
      return
    }
    req.url = `${apiPath}${search}`
    req.query = queryFromSearch(search)
    if (!route.rawBody) await assignParsedBody(req)
    await route.handler(req, res)
    if (!res.writableEnded && !res.headersSent) {
      sendJson(res, 500, { error: 'Handler did not respond' })
    }
    return
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    await serveSpa(req, res, distDir)
    return
  }
  sendJson(res, 404, { error: 'Not found' })
}
