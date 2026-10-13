/**
 * Load and save a driver W-9 without ever keeping the full TIN in app state
 * after the save returns. Stripe Connect drivers are sent to Stripe instead.
 */
import { authedJson } from './apiClient.js'
import {
  W9_PUBLIC_COLUMNS,
  responseContainsTin,
  tinDigits,
  toPublicW9,
  w9FormIssue,
} from '../../shared/driverW9.js'

const TAX_INFO_COLUMNS = 'legal_name, business_name, tax_classification, address_line, tin_last4, updated_at'

function missingRelation(error) {
  return /schema cache|does not exist|could not find the table|column/i.test(error?.message || '')
}

async function loadLocalW9(supabase, userId) {
  if (!supabase || !userId) return null
  const primary = await supabase.from('driver_w9').select(W9_PUBLIC_COLUMNS).eq('profile_id', userId).maybeSingle()
  if (!primary.error && primary.data) return toPublicW9(primary.data)
  if (primary.error && !missingRelation(primary.error)) throw new Error(primary.error.message)
  const fallback = await supabase.from('driver_tax_info').select(TAX_INFO_COLUMNS).eq('profile_id', userId).maybeSingle()
  if (fallback.error) {
    if (missingRelation(fallback.error)) return null
    throw new Error(fallback.error.message)
  }
  if (!fallback.data) return null
  return toPublicW9({ ...fallback.data, collection: 'app', certified: false })
}

export async function loadDriverW9(supabase, userId) {
  let desk = null
  if (supabase) {
    try {
      desk = await authedJson(supabase, '/api/driver?action=w9')
    } catch {
      desk = null
    }
  }
  const local = await loadLocalW9(supabase, userId).catch(() => null)
  const status = toPublicW9(desk?.status) || local
  return {
    stripeConnect: Boolean(desk?.stripeConnect),
    updateUrl: typeof desk?.updateUrl === 'string' ? desk.updateUrl : null,
    stripeDetailsSubmitted: desk?.stripeDetailsSubmitted === true,
    stripeError: typeof desk?.stripeError === 'string' ? desk.stripeError : null,
    status,
  }
}

export async function saveDriverW9Record(supabase, input) {
  const issue = w9FormIssue(input)
  if (issue) throw new Error(issue)
  if (!supabase) throw new Error('Supabase is not configured')
  const digits = tinDigits(input.tin)
  const { data, error } = await supabase.rpc('save_driver_w9_record', {
    legal_name: String(input.legalName || '').trim(),
    business_name: String(input.businessName || '').trim() || null,
    tax_classification: input.taxClassification,
    address_line: String(input.address || '').trim(),
    tin: digits,
    tin_kind: input.tinKind,
    certified: true,
    signature_name: String(input.signatureName || '').trim(),
    signed_on: input.signedOn,
  })
  if (error) throw new Error(error.message)
  const pub = toPublicW9(data)
  if (responseContainsTin(pub, digits)) {
    throw new Error('The tax id came back from the save and was discarded.')
  }
  return pub
}
