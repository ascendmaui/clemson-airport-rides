/**
 * Driver credit for a post-ride tip.
 * Earnings already include trips.tip_cents (80% driver / 20% platform).
 * The Connect transfer runs at settlement for the fare and does not pick up
 * a tip added after that, so the tip is recorded as owed. No new transfer.
 */
import { splitPlatformFee } from '../src/lib/fareRates.js'

export function tipCreditRecord({ driverId, amountCents, paymentIntentId = null, tipPercent = null }) {
  const split = splitPlatformFee(amountCents)
  const percent = tipPercent == null || tipPercent === '' ? null : Number(tipPercent)
  return {
    split,
    owed: {
      driverId: driverId || null,
      amountCents: split.amountCents,
      driverEarningsCents: split.driverEarningsCents,
      platformFeeCents: split.platformFeeCents,
      status: 'owed',
      paymentIntentId: paymentIntentId || null,
      tipPercent: Number.isFinite(percent) ? percent : null,
      payout: 'recorded_owed',
    },
  }
}

export function tipChargeResponse(credit, extra = {}) {
  return {
    ...extra,
    driverId: credit.owed.driverId,
    driverEarningsCents: credit.owed.driverEarningsCents,
    platformFeeCents: credit.owed.platformFeeCents,
    credit: 'owed',
  }
}
