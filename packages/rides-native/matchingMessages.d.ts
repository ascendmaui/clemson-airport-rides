export const OFFLINE_WHILE_OFFERED_MESSAGE: string
export const SEARCHING_CANCEL_ACCEPT_MESSAGE: string
export const DECLINE_NEXT_DRIVER_MESSAGE: string
export const DECLINE_OPEN_POOL_MESSAGE: string
export const DECLINE_STILL_SEARCHING_MESSAGE: string
export const RIDER_DECLINE_NEXT_MESSAGE: string
export const RIDER_DECLINE_OPEN_MESSAGE: string

export function offlineWhileOfferedMessage(input?: {
  online?: boolean | null
  card?: { status?: string | null } | null
}): string | null

export function searchingCancelOfferMessage(trip: unknown): string | null

export function declinePassMessage(result?: {
  unchanged?: boolean
  offerDriverId?: string | null
  nextDriverId?: string | null
  released?: boolean
  keptSearching?: boolean
} | null): string | null

export function riderDeclineRebroadcastMessage(trip: unknown): string | null
