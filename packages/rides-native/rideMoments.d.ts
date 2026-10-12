export type MomentCue = 'arrived' | 'complete' | 'canceled' | 'error' | 'tip' | 'chat' | 'online'
export type Moment = { key: string; tone: 'info' | 'success' | 'warning' | 'error'; title: string; body: string; cue: MomentCue }
export type RiderTripSnapshot = { status: string | null; driverCancels: number; hold: string | null }
export function fareHoldStatus(row: any): string | null
export function riderTripSnapshot(row: any): RiderTripSnapshot | null
export function riderTripMoment(prev: RiderTripSnapshot | null, row: any): Moment | null
export function paymentFailedMoment(prevHold: string | null | undefined, row: any, role?: 'rider' | 'driver'): Moment | null
export function driverTipMoment(prevTipCents: number | null | undefined, row: any): Moment | null
export function chatMessageMoment(message: any, selfId: string | null | undefined, opts?: { viewingTripId?: string | null }): Moment | null
export function backOnlineMoment(sentCount: number): Moment | null
