/** Client-side claim rules. The database trigger is the source of truth. */

export const LOST_FOUND_STATUSES = ['open', 'claimed', 'returned', 'closed']

export function statusLabel(status) {
  switch (status) {
    case 'open':
      return 'Open'
    case 'claimed':
      return 'Claimed'
    case 'returned':
      return 'Returned'
    case 'closed':
      return 'Closed'
    default: {
      const unknown = status
      return unknown ? String(unknown) : 'Open'
    }
  }
}

export function resolutionLabel(resolution) {
  switch (resolution) {
    case 'found':
      return 'Found'
    case 'not_found':
      return 'Not found'
    case null:
    case undefined:
    case '':
      return ''
    default:
      return ''
  }
}

export function claimChoices(report, userId) {
  const none = {
    canConfirmFound: false,
    canConfirmNotFound: false,
    canMessage: false,
    canSupportNote: false,
    canMarkReturned: false,
    canClose: false,
    canWithdraw: false,
  }
  if (!report || !userId) return none
  const isReporter = report.reporterId === userId || report.reporter_id === userId
  const isCounterpart = report.counterpartId === userId || report.counterpart_id === userId
  const party = isReporter || isCounterpart
  if (!party) return none
  const status = report.status
  if (status === 'open') {
    return {
      ...none,
      canConfirmFound: isCounterpart,
      canConfirmNotFound: isCounterpart,
      canWithdraw: isReporter,
      canSupportNote: isCounterpart || isReporter,
    }
  }
  if (status === 'claimed') {
    return {
      ...none,
      canMessage: true,
      canSupportNote: true,
      canMarkReturned: true,
      canClose: true,
    }
  }
  if (status === 'returned') {
    return {
      ...none,
      canMessage: true,
      canSupportNote: true,
      canClose: true,
    }
  }
  if (status === 'closed') return none
  const _exhaustive = status
  void _exhaustive
  return none
}

export function friendlyLostFoundError(message) {
  const m = String(message || '')
  if (/only the other party can confirm/i.test(m)) {
    return 'Only the other person on this ride can confirm whether it was found.'
  }
  if (/invalid status transition/i.test(m)) {
    return 'That step does not match this report’s status.'
  }
  if (/immutable lost and found/i.test(m)) {
    return 'The item description and ride cannot be changed after you send the report.'
  }
  if (/row-level security|permission denied|not a party/i.test(m)) {
    return 'You can only open lost-and-found reports for your own completed rides.'
  }
  if (/lost_found_reports|schema cache|relation .* does not exist/i.test(m)) {
    return 'Lost and found is not available yet. Try again in a moment.'
  }
  if (/between 2 and 400|item_len/i.test(m)) {
    return 'Describe the item in a few words (2–400 characters).'
  }
  return m || 'Could not update this report.'
}
