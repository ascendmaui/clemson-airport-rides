import type { DriverCard } from './tripTags'

export type TripEndLine = { key: string; label: string; value: string; note?: string | null }
export function tripEndSummary(card: Partial<DriverCard> | null | undefined): {
  title: string
  lines: TripEndLine[]
  net: { label: string; value: string; cents: number }
  tip: { label: string; value: string; note: string; pending: boolean; headline: string | null; cents: number }
  payoutLine: string
  accessibilityLabel: string
}
export function tipLine(riderFirstName: string | null | undefined, tipCents: number): string | null
export const POSITIVE_RATING_TAGS: readonly string[]
export const ISSUE_RATING_TAGS: readonly string[]
export const RATING_TAGS: readonly string[]
export const MAX_RATING_TAGS: number
export function ratingTagOptions(stars: number): string[]
export function normalizeRatingTags(tags: unknown, stars: number): string[]
export function toggleRatingTag(tags: string[], tag: string, stars: number): string[]
export function backInQueueCopy(online: boolean): {
  kicker: string
  title: string
  body: string
  primary: string
  secondary: string
}
