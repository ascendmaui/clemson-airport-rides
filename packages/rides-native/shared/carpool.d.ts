export type Place = { label: string; lat: number; lng: number }

export type Neighborhood = {
  id: string
  label: string
  lat: number
  lng: number
  aliases: string[]
}

export type NeighborhoodGroup = {
  id: 'housing' | 'bars' | 'campus'
  label: string
  ids: string[]
}

export type DemandWindow = 'game_day' | 'peak_night' | 'class_change' | 'off_peak'

export type CarpoolShare = {
  id: string
  firstName?: string
  soloCents: number
  shareCents: number
  savingsCents?: number
  window?: DemandWindow
  firstRideFree?: boolean
}

export type CarpoolDriver = {
  payoutCents: number
  soloPayoutCents: number
  carpoolBonusCents: number
  beatsSolo?: boolean
}

export type CarpoolQuote = {
  riderCount: number
  shareOfSolo?: number
  shares: CarpoolShare[]
  grossCents?: number
  driver?: CarpoolDriver
}

export type SurgeDelta = {
  soloSurgeCents: number
  fullCarShareCents: number
  savingsCents: number
  driverPayoutCents: number
  driverSoloPayoutCents: number
  driverBonusCents: number
  driverBeatsSolo: boolean
  window: DemandWindow
  currentShareCents: number | null
  currentShareId: string | null
  currentRiderCount: number | null
  currentFirstRideFree: boolean
  currentSavingsCents: number | null
}

export type PitchQuote = {
  soloCents: number
  fullShareCents: number
  savingsCents: number
  window: DemandWindow
  full: { driver: CarpoolDriver }
  solo: CarpoolQuote
}

export const NEIGHBORHOODS: Neighborhood[]
export const MAX_RIDERS: number
export const SHARE_OF_SOLO: Record<number, number>
export const HOT_NEIGHBORHOOD_IDS: string[]
export const NEIGHBORHOOD_GROUPS: NeighborhoodGroup[]

export function demandWindow(at?: Date, options?: { gameDay?: boolean }): DemandWindow
export function formatUsd(cents: number): string
export function illustrativePeakAt(from?: Date): Date
export function isGameWeek(at?: Date): boolean
export function firstRideWindowOpen(at?: Date, options?: { gameDay?: boolean; enabled?: boolean }): boolean
export function firstRideEligible(input?: {
  windowOpen?: boolean
  alreadyUsed?: boolean
  completedTrips?: number
  schemaMissing?: boolean
  lookupFailed?: boolean
}): boolean
export function firstRideOfferCopy(input?: {
  windowOpen?: boolean
  signedIn?: boolean
  alreadyUsed?: boolean
  completedTrips?: number
  schemaMissing?: boolean
  lookupFailed?: boolean
}): { eligible: boolean; title: string; body: string } | null
export function confirmChargeLabel(input?: {
  booked?: boolean
  busyLabel?: string
  isCarpool?: boolean
  shareCents?: number | null
  firstRideFree?: boolean
}): string
export function confirmChargeNote(input?: {
  shareCents?: number | null
  firstRideFree?: boolean
  riderCount?: number | null
  fullCarShareCents?: number | null
  fullCarNow?: boolean
}): string | null
export function otherFirstRideLabels(quote: CarpoolQuote | null | undefined, exceptId?: string | null): string[]
export function pitchQuote(input: {
  pickup: Place
  dropoff: Place
  at?: Date
  gameDay?: boolean
  displayName?: string
}): PitchQuote
export function surgeDelta(input: {
  pickup?: Place | null
  dropoff?: Place | null
  at?: Date
  quote?: CarpoolQuote | null
  selfId?: string | null
}): SurgeDelta | null
export function quoteCarpool(input: {
  riders: { id?: string; displayName?: string; pickup: Place; dropoff: Place; departAt?: Date }[]
  at?: Date
  gameDay?: boolean
}): CarpoolQuote
export function resolveNeighborhood(point: { label?: string; lat?: number; lng?: number } | null): Neighborhood | null
export function carpoolSeatCap(input: {
  kind?: string
  partyType?: string
  matchMode?: string
  vehicleSeats?: number
}): number

export function neighborhoodById(id: string): Neighborhood | null
export function hotNeighborhoods(): Neighborhood[]
export function neighborhoodsInGroup(groupId: NeighborhoodGroup['id'] | 'all'): Neighborhood[]
export function searchNeighborhoods(query: string): Neighborhood[]
export function placeOf(neighborhood: { label: string; lat: number; lng: number }): Place
export function defaultCarpoolEnds(): { pickup: Place; dropoff: Place }
export function clusterOf(point: { label?: string; lat?: number; lng?: number } | null): { id: string; label: string } | null
export function parseCarpoolToken(raw: string): string
export function formatEta(seconds: number): string
export function formatMiles(meters: number): string
export type CatalogStop = {
  id: string
  label: string
  lat: number
  lng: number
  kind: 'campus' | 'airport'
  aliases: string[]
}

export function catalogStops(): CatalogStop[]
export function searchCatalogPlaces(query: string): CatalogStop[]
export function lookupCatalogPlace(label: string | null | undefined): CatalogStop | null
export function placeFromStop(stop: CatalogStop | null | undefined): Place | null
export function hotCatalogPlaces(): CatalogStop[]
export const OFFER_CARPOOL_STEPS: string[]
export const OFFER_CARPOOL_MAPS_NOTE: string

export function riderDisplayName(user: { email?: string | null; user_metadata?: { full_name?: string } } | null | undefined): string
