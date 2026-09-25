/**
 * Test double for server/friendRideLib.js. No Supabase, Stripe, or network.
 * admin() and userFromAuth() read mutable state set by the test.
 */

export const state = {
  client: null,
  user: null,
}

export function admin() {
  return state.client
}

export async function userFromAuth() {
  return state.user
}

export function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.end(JSON.stringify(body))
}

export function cors(req, res) {
  if (req.method === 'OPTIONS') {
    json(res, 204, {})
    return true
  }
  return false
}

export function parseBody(req) {
  let body = req.body
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body || '{}')
    } catch {
      return { error: 'Invalid JSON' }
    }
  }
  return { body: body || {} }
}
