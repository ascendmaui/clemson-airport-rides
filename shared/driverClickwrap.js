/**
 * Driver clickwrap. Signup and onboarding stay closed until the current
 * version is accepted. A later version asks again on the next launch.
 */

import { PRIVACY_SECTIONS, TERMS_SECTIONS } from './legalCopy.js'

export const DRIVER_CLICKWRAP_VERSION = 'driver-clickwrap-2026-10-13-r2'

export const CLICKWRAP_STORAGE_KEY = 'clemson.driver.clickwrap.version'

export const DRIVER_CLICKWRAP_SUMMARY = 'You are an independent contractor. You have no employment, agency, or partnership with Clemson RIDES, and you are solely responsible for your conduct, vehicle, insurance, and legal compliance, including the South Carolina transportation-network acknowledgments. The platform may warn, suspend, or deactivate you, or forfeit incentives, at its sole discretion. To the fullest extent permitted by law, the platform is not liable for a legal claim arising from your acts or omissions, and you indemnify and defend the platform. Checking the box and tapping I Agree is your electronic signature under the E-SIGN Act.'

export function agreeButtonDisabled(checked) {
  return checked !== true
}

export function acceptClickwrap({ checked }) {
  return checked === true
}

export function mayCreateDriverAccount(clickwrapAccepted) {
  return clickwrapAccepted === true
}

export function mayEnterOnboarding(acceptance, version = DRIVER_CLICKWRAP_VERSION) {
  if (!acceptance || typeof acceptance !== 'object') return false
  const storedVersion = acceptance.agreementVersion || acceptance.agreement_version
  const userId = acceptance.userId || acceptance.user_id
  const acceptedAt = acceptance.acceptedAt || acceptance.accepted_at
  return storedVersion === version && Boolean(userId) && Boolean(acceptedAt)
}

export function needsClickwrapPrompt(acceptance, version = DRIVER_CLICKWRAP_VERSION) {
  return !mayEnterOnboarding(acceptance, version)
}

export async function loadDriverClickwrapPhase({ storage, fetchStatus, version = DRIVER_CLICKWRAP_VERSION }) {
  const stored = storage ? await storage.getItem(CLICKWRAP_STORAGE_KEY) : null
  if (stored === version) return 'ok'
  let status
  try {
    status = await fetchStatus()
  } catch {
    return 'required'
  }
  if (status?.accepted === true && status.requiredVersion === version && mayEnterOnboarding(status.acceptance, version)) {
    if (storage) await storage.setItem(CLICKWRAP_STORAGE_KEY, version)
    return 'ok'
  }
  return 'required'
}

export function legalDocument(doc) {
  switch (doc) {
    case 'privacy':
      return { title: 'Privacy Policy', sections: PRIVACY_SECTIONS }
    case 'terms':
      return { title: 'Terms of Service', sections: TERMS_SECTIONS }
    case 'driver-agreement':
      return {
        title: 'Driver Agreement',
        sections: TERMS_SECTIONS.filter((section) => section.heading.includes('Driver Agreement')),
      }
    default: {
      const unknown = doc
      throw new Error(`Unknown legal document: ${String(unknown)}`)
    }
  }
}
