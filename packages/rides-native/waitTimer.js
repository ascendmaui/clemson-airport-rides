import { CANCEL_AVAILABLE_MS, formatClock, formatUsd, quoteWait, settleWait } from '../../src/lib/waitFee.js'

/** Advance the server clock locally between wait ticks, correcting device clock skew. */
export function waitTimerView(arrivedAt, now = Date.now(), anchor = null) {
  const serverNow = anchor?.arrivedAt === arrivedAt
    ? anchor.serverNowMs + (now - anchor.clientNowMs)
    : now
  const quote = quoteWait(arrivedAt, serverNow)
  const cancel = settleWait(quote.elapsedMs, quote.autoDue ? 'auto' : 'driver')
  const countdown = formatClock(Math.ceil(Math.max(0, CANCEL_AVAILABLE_MS - quote.elapsedMs) / 1000) * 1000)
  const feeLabel = quote.waitFeeCents === 0 ? 'Free wait' : `${formatUsd(quote.waitFeeCents)} wait fee`
  const buttonLabel = quote.autoDue ? 'Canceling ride…' : quote.cancelAvailable
    ? 'Rider no-show · Cancel ride'
    : `Rider no-show · Cancel ride in ${countdown}`
  return {
    ...quote, feeLabel, countdown, buttonLabel,
    riderChargeCents: cancel.riderChargeCents,
    driverEarningsCents: cancel.driverEarningsCents,
    accessibilityLabel: `Wait timer ${quote.clock}. ${feeLabel}.`,
  }
}

export function waitTimerAnchor(arrivedAt, serverNow, clientNowMs = Date.now()) {
  const serverNowMs = new Date(serverNow).getTime()
  return arrivedAt && Number.isFinite(serverNowMs) ? { arrivedAt, serverNowMs, clientNowMs } : null
}
