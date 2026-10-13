export const CANCELED_STATUSES: readonly string[]
export function releasedTripCard<T extends { id: string }>(previous: T | null | undefined): (T & { status: 'canceled'; released: true }) | null
export function nextDriverTripCard<T extends { id: string; status: string; released?: boolean }>(previous: T | null | undefined, row: T | null | undefined): T | null
export type DriverCanceledView = { title: string; body: string; action: string; announcement: string }
export function driverCanceledView(card: { status: string; firstName?: string; released?: boolean } | null | undefined): DriverCanceledView | null
export const MISSING_TRIP_VIEW: Readonly<{ title: string; body: string; action: string }>
