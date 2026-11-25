/**
 * Geoapify browser key, inlined by Vite at build time from VITE_GEOAPIFY_API_KEY.
 * Production builds read it from the GitHub Actions secret of the same name
 * (Deploy VPS workflow -> Docker build-arg). Empty under node tests.
 */
const env = import.meta.env || {}

export const GEOAPIFY_API_KEY = String(env.VITE_GEOAPIFY_API_KEY || '').trim()
