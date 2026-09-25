import type { DriverCard, FareCollection } from './tripTags'

export const DEFAULT_OFFER_TTL_SECONDS: number

export function shortPlaceLabel(label?: string | null, fallback?: string): string
export function pickupShortLabel(cardOrLabel?: DriverCard | { pickupLabel?: string; pickup_label?: string } | string | null, fallback?: string): string
export function dropoffShortLabel(cardOrLabel?: DriverCard | { dropoffLabel?: string; dropoff_label?: string } | string | null, fallback?: string): string
export function routeHeadline(cardOrPickup?: DriverCard | string | null, dropoff?: string | null): string

export type DriverNetPayModel = {
  netCents: number
  formattedNet: string
  baseNetCents: number | null
  formattedBaseNet: string | null
  carpoolBonusCents: number | null
  formattedCarpoolBonus: string | null
  carpoolIncentiveId: string | null
  isCarpool: boolean
  platformFeeCents: number
  formattedPlatformFee: string
  subtext: string
}

export function formatDriverNetPay(card?: DriverCard | Record<string, unknown> | null): DriverNetPayModel
export function driverNetPayText(card?: DriverCard | Record<string, unknown> | null): string

export function formatEta(etaMin?: number | string | null): string | null
export function formatDistance(distanceMi?: number | string | null): string | null
export function formatDistanceEta(
  cardOrEta?: DriverCard | Record<string, unknown> | number | string | null,
  distanceMi?: number | string | null,
): string | null

export type SeatsModel = {
  count: number | null
  seatsLabel: string | null
  ridersLabel: string | null
}

export function formatSeats(cardOrCount?: DriverCard | Record<string, unknown> | number | string | null): string | null
export function seatsViewModel(cardOrCount?: DriverCard | Record<string, unknown> | number | string | null): SeatsModel

export type BadgeTone = 'orange' | 'purple'

export type OfferBadge = {
  id: string
  label: string
  shortLabel?: string
  amountCents?: number
  formattedAmount?: string
  code?: string | null
  tone: BadgeTone
}

export function isAirportTrip(card?: DriverCard | Record<string, unknown> | null): boolean
export function airportBadge(card?: DriverCard | Record<string, unknown> | null): OfferBadge | null
export function depositBadge(card?: DriverCard | Record<string, unknown> | null): OfferBadge | null
export function offerBadges(card?: DriverCard | Record<string, unknown> | null): OfferBadge[]

export type TimeLeftOptions = {
  now?: Date | string | number
  ttlSeconds?: number
}

export type TimeLeftModel = {
  seconds: number | null
  label: string
  isExpired: boolean
  isUrgent: boolean
}

export function timeLeftToAcceptSeconds(
  cardOrSeconds?: DriverCard | Record<string, unknown> | number | null,
  options?: TimeLeftOptions,
): number | null

export function timeLeftToAcceptLabel(
  cardOrSeconds?: DriverCard | Record<string, unknown> | number | null,
  options?: TimeLeftOptions,
): string | null

export function isOfferExpired(
  cardOrSeconds?: DriverCard | Record<string, unknown> | number | null,
  options?: TimeLeftOptions,
): boolean

export type OfferCardViewModel = {
  id: string | null
  status: string
  rider: {
    firstName: string
    rating: number | null
    ratingText: string | null
    rideType: string | null
  }
  pickup: {
    label: string
    shortLabel: string
  }
  dropoff: {
    label: string
    shortLabel: string
  }
  routeHeadline: string
  pay: DriverNetPayModel
  distanceEta: string | null
  eta: string | null
  distance: string | null
  seats: SeatsModel
  badges: OfferBadge[]
  airport: OfferBadge | null
  deposit: OfferBadge | null
  isAirport: boolean
  timeLeft: TimeLeftModel | null
  timeLeftLabel: string | null
  pickupAtText: string | null
  accessibilityLabel: string
}

export function offerAccessibilityLabel(
  cardOrVm?: DriverCard | OfferCardViewModel | Record<string, unknown> | null,
  options?: TimeLeftOptions,
): string

export function offerCardViewModel(
  card?: DriverCard | Record<string, unknown> | null,
  options?: TimeLeftOptions,
): OfferCardViewModel

export const formatOfferCard: typeof offerCardViewModel
