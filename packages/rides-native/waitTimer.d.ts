export type WaitAnchor = { arrivedAt: string; serverNowMs: number; clientNowMs: number }
export function waitTimerAnchor(arrivedAt: string | null, serverNow: string, clientNowMs?: number): WaitAnchor | null
export function waitTimerView(arrivedAt: string | null, now?: number, anchor?: WaitAnchor | null): {
  clock: string; feeLabel: string; countdown: string; buttonLabel: string; accessibilityLabel: string
  elapsedMs: number; displayMs: number; waitFeeCents: number; inGrace: boolean
  cancelAvailable: boolean; autoDue: boolean; riderChargeCents: number; driverEarningsCents: number
}
