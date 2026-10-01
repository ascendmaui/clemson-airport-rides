import {
  isUserFacing,
  friendlyApiError,
  GENERIC_ERROR_COPY,
  UNAVAILABLE_COPY,
  ENV_VAR_PATTERN,
  UNAVAILABLE_PATTERN,
} from './apiErrors.js'

/**
 * Normalizes any error value (Error, string, status code, or response object)
 * into safe, rider-facing copy, preventing leakage of internal stack traces,
 * database strings, or server environment variables.
 */
export function normalizeErrorCopy(error, defaultMessage = GENERIC_ERROR_COPY) {
  if (!error) return ''

  if (typeof error === 'string') {
    const trimmed = error.trim()
    if (!trimmed) return ''
    if (ENV_VAR_PATTERN.test(trimmed) || UNAVAILABLE_PATTERN.test(trimmed)) {
      return UNAVAILABLE_COPY
    }
    if (
      /\b(?:5\d{2}|4\d{2})\b/i.test(trimmed) &&
      /server\s*error|internal|gateway|timeout|http/i.test(trimmed)
    ) {
      return defaultMessage
    }
    if (!isUserFacing(trimmed)) {
      return defaultMessage
    }
    return trimmed
  }

  if (typeof error === 'object') {
    const mapped = friendlyApiError(error.status ?? error.statusCode, error)
    if (mapped?.message) return mapped.message
    if (typeof error.message === 'string') {
      return normalizeErrorCopy(error.message, defaultMessage)
    }
  }

  return defaultMessage
}
