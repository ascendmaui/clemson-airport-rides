/**
 * One place for the production web/API origin used by the native apps.
 * The value lives in shared/productLinks.js (WEB_ORIGIN) so web, server and native agree.
 * EXPO_PUBLIC_API_BASE overrides it for API calls (preview builds, local dev).
 */
import { WEB_ORIGIN } from '../../shared/productLinks.js'

export const DEFAULT_API_BASE = WEB_ORIGIN

export function resolveApiBase() {
  const envVal =
    typeof process !== 'undefined' && process?.env
      ? process.env.EXPO_PUBLIC_API_BASE
      : undefined
  const raw = typeof envVal === 'string' ? envVal.trim().replace(/\/+$/, '') : ''
  return raw || String(DEFAULT_API_BASE).replace(/\/+$/, '')
}

