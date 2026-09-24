import type { DriverCard } from './tripTags.js'

export function approvalGateMessage(): string

export type SyntheticOffer = DriverCard & {
  isSynthetic: true
  riderRating: number
  etaMin: number
  distanceMi: number
  rideType: string
}

export function syntheticOffers(now?: Date): SyntheticOffer[]
export function isSyntheticOffer(card: { id?: string; isSynthetic?: boolean } | null | undefined): boolean
