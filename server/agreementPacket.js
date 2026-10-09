/**
 * Unsigned agreement packet stored with an application.
 * The canonical agreement text is never edited; particulars are re-rendered from application data.
 */
import { createHash } from 'node:crypto'
import { IC_AGREEMENT_VERSION } from '../shared/icAgreement.js'
import { buildAgreementPrefill, renderPrefilledAgreement } from '../shared/agreementPrefill.js'

export function hashAgreementHtml(html) {
  return createHash('sha256').update(String(html), 'utf8').digest('hex')
}

function schemaMissing(error, token) {
  return Boolean(error && new RegExp(`${token}|schema cache|does not exist`, 'i').test(error.message || ''))
}

async function maybeRow(query) {
  const result = await query
  return result
}

export async function loadAgreementSources(sb, profileId) {
  const [profileRes, appRes, vehicleRes, docsRes] = await Promise.all([
    maybeRow(sb.from('profiles').select('full_name, email, phone').eq('id', profileId).maybeSingle()),
    maybeRow(sb.from('driver_applications').select('applicant_email, work_eligibility_category').eq('profile_id', profileId).maybeSingle()),
    maybeRow(
      sb.from('vehicles')
        .select('id, make, model, color, plate, seats')
        .eq('driver_id', profileId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ),
    maybeRow(sb.from('driver_documents').select('doc_type').eq('profile_id', profileId)),
  ])

  let taxRes = await sb.from('driver_tax_info')
    .select('legal_name, tin_last4, tax_classification, address_line, business_name')
    .eq('profile_id', profileId)
    .maybeSingle()
  if (schemaMissing(taxRes.error, 'address_line|business_name')) {
    taxRes = await sb.from('driver_tax_info')
      .select('legal_name, tin_last4, tax_classification')
      .eq('profile_id', profileId)
      .maybeSingle()
  }

  const error = profileRes.error || appRes.error || vehicleRes.error || docsRes.error || taxRes.error
  if (error) return { error: error.message }

  const docs = docsRes.data || []
  const uploaded = new Set(docs.map((row) => row.doc_type))
  const tax = taxRes.data || {}
  const profile = profileRes.data || {}
  const app = appRes.data || {}
  const vehicle = vehicleRes.data || {}

  return {
    vehicleId: vehicle.id || null,
    prefillInput: {
      legalName: tax.legal_name,
      fullName: profile.full_name,
      address: tax.address_line,
      phone: profile.phone,
      email: profile.email,
      applicantEmail: app.applicant_email,
      vehicle: {
        make: vehicle.make,
        model: vehicle.model,
        color: vehicle.color,
        plate: vehicle.plate,
        seats: vehicle.seats,
      },
      licenseOnFile: uploaded.has('license_front') && uploaded.has('license_back'),
      taxClassification: tax.tax_classification,
      businessName: tax.business_name,
      tinLast4: tax.tin_last4,
      workEligibilityCategory: app.work_eligibility_category,
    },
  }
}

export function packetFromSources(profileId, sources, now = new Date()) {
  const prefill = buildAgreementPrefill(sources.prefillInput || {})
  const html = renderPrefilledAgreement(prefill)
  return {
    profileId,
    version: IC_AGREEMENT_VERSION,
    prefill,
    html,
    sha256: hashAgreementHtml(html),
    updatedAt: now.toISOString(),
  }
}

export async function attachUnsignedPacket(sb, profileId, now = new Date()) {
  const sources = await loadAgreementSources(sb, profileId)
  if (sources.error) return { error: sources.error, emailed: false }
  const packet = packetFromSources(profileId, sources, now)
  const { error } = await sb.from('driver_agreement_packets').upsert({
    profile_id: packet.profileId,
    agreement_version: packet.version,
    prefill: packet.prefill,
    html_snapshot: packet.html,
    html_sha256: packet.sha256,
    updated_at: packet.updatedAt,
  }, { onConflict: 'profile_id,agreement_version' })
  if (error) return { error: error.message, emailed: false }
  return { packet, emailed: false }
}

export async function applyParticularCorrections(sb, profileId, updates, now = new Date()) {
  if (updates.phone != null) {
    const { error } = await sb.from('profiles').update({ phone: updates.phone }).eq('id', profileId)
    if (error) return { error: error.message }
  }

  const taxPatch = {}
  if (updates.legal_name != null) taxPatch.legal_name = updates.legal_name
  if (updates.address_line != null) taxPatch.address_line = updates.address_line || null
  if (updates.business_name != null) taxPatch.business_name = updates.business_name || null
  if (Object.keys(taxPatch).length) {
    taxPatch.updated_at = now.toISOString()
    const { error } = await sb.from('driver_tax_info').update(taxPatch).eq('profile_id', profileId)
    if (error) return { error: error.message }
  }

  const vehiclePatch = {}
  if (updates.vehicle_make != null) vehiclePatch.make = updates.vehicle_make
  if (updates.vehicle_model != null) vehiclePatch.model = updates.vehicle_model
  if (updates.vehicle_color != null) vehiclePatch.color = updates.vehicle_color
  if (updates.vehicle_plate != null) vehiclePatch.plate = updates.vehicle_plate
  if (updates.vehicle_seats != null) vehiclePatch.seats = Number(updates.vehicle_seats)
  if (Object.keys(vehiclePatch).length) {
    const { data: vehicle, error: findError } = await sb.from('vehicles')
      .select('id')
      .eq('driver_id', profileId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (findError) return { error: findError.message }
    if (!vehicle?.id) return { error: 'No vehicle on file' }
    const { error } = await sb.from('vehicles').update(vehiclePatch).eq('id', vehicle.id)
    if (error) return { error: error.message }
  }

  return attachUnsignedPacket(sb, profileId, now)
}
