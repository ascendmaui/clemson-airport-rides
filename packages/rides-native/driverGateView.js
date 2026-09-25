import { approvalGateMessage } from './syntheticOffers.js'
import { REQUIRED_DOCUMENTS, blockerLabel, ONBOARDING_STATUSES } from '../../shared/driverOnboarding.js'

export const APPROVAL_GATE = approvalGateMessage()
export { approvalGateMessage, ONBOARDING_STATUSES }

function formatMissing(missing) {
  if (!missing) return ''
  const items = Array.isArray(missing) ? missing : [missing]
  if (!items.length) return ''
  const labels = items.map((item) => {
    if (!item) return ''
    if (typeof item === 'string') {
      const doc = REQUIRED_DOCUMENTS.find((d) => d.id === item)
      if (doc) return doc.label
      return blockerLabel(item)
    }
    return item?.label || item?.id || String(item)
  }).filter(Boolean)
  return labels.join(', ')
}

/**
 * Driver gate view: derives display copy and capabilities from onboarding status.
 * Reuses existing copy from syntheticOffers.js (APPROVAL_GATE), driverDesk.js, and index.tsx.
 *
 * @param {string | null | undefined} onboardingStatus Status from driver_applications.onboarding_status
 * @param {{ rejectionReason?: string | null, missingItems?: Array<string | object> | string | null }} [options]
 * @returns {{ canGoOnline: boolean, canSeeOffers: boolean, title: string, body: string, primaryAction: string | null }}
 */
export function driverGateView(onboardingStatus, { rejectionReason, missingItems } = {}) {
  const missingStr = formatMissing(missingItems)

  switch (onboardingStatus) {
    case 'approved':
      return {
        canGoOnline: true,
        canSeeOffers: true,
        title: 'Approved',
        body: 'You are approved to go online and accept rides.',
        primaryAction: null,
      }

    case 'pending_review':
      return {
        canGoOnline: false,
        canSeeOffers: false,
        title: 'Application under review',
        body: APPROVAL_GATE,
        primaryAction: 'View application',
      }

    case 'pending_docs': {
      const body = missingStr
        ? `License, insurance, registration, and car photos come before you submit. Missing: ${missingStr}.`
        : 'License, insurance, registration, and car photos come before you submit. You can keep setting up the account after that.'
      return {
        canGoOnline: false,
        canSeeOffers: false,
        title: 'Finish your application',
        body,
        primaryAction: 'Continue application',
      }
    }

    case 'pending_info': {
      const body = missingStr
        ? `Add your info, vehicle, documents, W-9, and contractor agreement. Missing: ${missingStr}.`
        : 'Add your info, vehicle, documents, W-9, and contractor agreement. New drivers are not approved automatically.'
      return {
        canGoOnline: false,
        canSeeOffers: false,
        title: 'Finish driver signup',
        body,
        primaryAction: 'Continue application',
      }
    }

    case 'rejected': {
      let body = 'Update the flagged steps and submit again. You still cannot receive rides.'
      if (rejectionReason && typeof rejectionReason === 'string' && rejectionReason.trim()) {
        const reasonText = rejectionReason.trim()
        const cleanReason = reasonText.endsWith('.') ? reasonText.slice(0, -1) : reasonText
        body = `Update the flagged steps and submit again: ${cleanReason}. You still cannot receive rides.`
      }
      if (missingStr) {
        body += ` Missing: ${missingStr}.`
      }
      return {
        canGoOnline: false,
        canSeeOffers: false,
        title: 'Application needs changes',
        body,
        primaryAction: 'Continue application',
      }
    }

    case null:
    case undefined:
    case 'none':
    default:
      return {
        canGoOnline: false,
        canSeeOffers: false,
        title: 'Become a driver',
        body: 'For Clemson University students — and for drivers already on Uber or Lyft.',
        primaryAction: 'Become a driver',
      }
  }
}

export default driverGateView
