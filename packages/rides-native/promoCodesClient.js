/**
 * Campaign promo codes from the rider and driver apps. The server validates
 * everything; this file only calls it. See server/endpoints/promoCodes.js.
 */
import { authedJson } from './apiClient.js'
import { normalizePromoCode, promoReasonMessage } from '../../shared/promoCodes.js'

export const PROMO_DEVICE_KEY = 'clemson_promo_device_id'

function randomId() {
  const hex = '0123456789abcdef'
  let out = ''
  const bytes = new Uint8Array(16)
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes)
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  for (const b of bytes) out += hex[b >> 4] + hex[b & 15]
  return `dev-${out}`
}

/**
 * A random per-install id kept in app storage, used only for the
 * one-per-device promo limit. It is not a hardware id; a reinstall resets it,
 * which is why the server also limits per account and per card.
 */
export async function promoDeviceId(storage) {
  try {
    const saved = await storage?.getItem?.(PROMO_DEVICE_KEY)
    if (saved && /^[A-Za-z0-9-]{8,128}$/.test(saved)) return saved
    const fresh = randomId()
    await storage?.setItem?.(PROMO_DEVICE_KEY, fresh)
    return fresh
  } catch {
    return null
  }
}

/** Preview a code. Nothing is reserved; booking reserves it on the server. */
export async function checkPromoCode(supabase, { code, side = 'rider', fareCents, fetch: fetchImpl } = {}) {
  const norm = normalizePromoCode(code)
  if (!norm) return { ok: false, reason: 'no_code', message: promoReasonMessage('no_code') }
  const data = await authedJson(supabase, '/api/promo/check', {
    method: 'POST',
    body: { code: norm, side, ...(fareCents != null ? { fareCents } : {}) },
    fetch: fetchImpl,
  })
  return data?.ok ? data : { ...data, message: data?.message || promoReasonMessage(data?.reason) }
}

/** Attach a campaign code to this account at sign-up. Idempotent on the server. */
export async function claimCampaignPromo(supabase, { code, side = 'rider', deviceId = null, fetch: fetchImpl } = {}) {
  const norm = normalizePromoCode(code)
  if (!norm) return { ok: false, reason: 'no_code' }
  return authedJson(supabase, '/api/promo/claim', {
    method: 'POST',
    body: { code: norm, side, ...(deviceId ? { deviceId } : {}) },
    fetch: fetchImpl,
  })
}
