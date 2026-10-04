import { isUserFacing } from '../../packages/rides-native/apiErrors.js'

/** Rider-facing request failure. Prefers a clean server sentence over the generic mapper. */
export function requestFailureMessage(err) {
  const payloadError = typeof err?.payload?.error === 'string' ? err.payload.error : ''
  if (isUserFacing(payloadError)) return payloadError
  if (isUserFacing(err?.message)) return err.message
  return 'Could not request that driver'
}
