/**
 * Staging shares the production env file, including CRON_SECRET and Stripe.
 * The staging container sets DISABLE_CRON_ENDPOINTS=1 so a valid bearer
 * cannot run payouts, hold expiry, or offer rebroadcast. Dry-run is refused
 * too unless ALLOW_STAGING_DRY_RUN=1. Compose turns that on for staging
 * because a dry-run does not transfer money or write payout rows.
 */

function flagOn(value) {
  const v = String(value ?? '').trim().toLowerCase()
  return v === '1' || v === 'true'
}

export function cronEndpointsDisabled(env = process.env) {
  return flagOn(env?.DISABLE_CRON_ENDPOINTS)
}

export function stagingDryRunAllowed(env = process.env) {
  return flagOn(env?.ALLOW_STAGING_DRY_RUN)
}

/**
 * null when the request may continue.
 * 403 when this host has cron endpoints disabled.
 * A dry-run continues only when ALLOW_STAGING_DRY_RUN is on.
 */
export function stagingCronBlock(env = process.env, { dryRun = false } = {}) {
  if (!cronEndpointsDisabled(env)) return null
  if (dryRun && stagingDryRunAllowed(env)) return null
  return {
    status: 403,
    body: {
      error: dryRun
        ? 'Dry-run is disabled on this host'
        : 'Cron endpoints are disabled on this host',
    },
  }
}
