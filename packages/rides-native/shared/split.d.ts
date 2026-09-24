import type { CarpoolQuote, Place } from './carpool.js'
import type { RideSummary } from './carpoolApi.js'

export type SplitRow = {
  id: string
  name: string
  shareCents: number
  soloCents: number | null
  savingsCents: number | null
}

export type FriendSplitPreview = {
  rows: SplitRow[]
  totalCents: number | null
  splitMode: 'even' | 'by_distance' | null
  eachCents: number | null
  headline: { soloCents: number; shareCents: number; savingsCents: number } | null
}

export function friendSplitPreview(ride: RideSummary | null | undefined): FriendSplitPreview
export function friendChargeNeedsReview(
  shown: RideSummary | null | undefined,
  refreshed: RideSummary | null | undefined,
): boolean
export function mergeFriendQuote<T extends RideSummary | null | undefined>(
  shown: T,
  refreshed: RideSummary | null | undefined,
): T | RideSummary | null
export function quoteFromRide(ride: RideSummary | null | undefined): CarpoolQuote | null
export function liveCarpoolQuote(ride: {
  fare_breakdown?: { carpool?: CarpoolQuote } | null
  participants?: {
    id: string
    display_name?: string
    pickup?: Place | null
    dropoff?: Place | null
    fare_cents?: number | null
    is_self?: boolean
  }[]
} | null): CarpoolQuote | null
export function splitRows(ride: RideSummary | null): SplitRow[]
export function selfParticipantId(ride: RideSummary | null): string | null
