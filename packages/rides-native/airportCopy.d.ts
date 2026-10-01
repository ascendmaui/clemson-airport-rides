export type CanonicalAirportCode = 'GSP' | 'CLT' | 'ATL'

export type CanonicalAirportInfo = {
  code: CanonicalAirportCode
  name: string
  shortLabel: string
  placeLabel: string
  city: string
  state: string
  metro: string
  typicalDistanceMiles: number
  typicalDurationMinutes: number
  fallbackFareCents?: number
  floorCents?: number
  aliases: readonly string[]
}

export declare const CANONICAL_AIRPORTS: Record<CanonicalAirportCode, CanonicalAirportInfo>
export declare const AIRPORT_CODES: readonly CanonicalAirportCode[]

export declare function isAirportCode(code: unknown): code is CanonicalAirportCode
export declare function normalizeAirportCode(input: unknown): CanonicalAirportCode | null
export declare function getAirport(codeOrInput: unknown): CanonicalAirportInfo | null
export declare function formatAirportName(
  codeOrInput: unknown,
  style?: 'short' | 'full' | 'place' | 'code' | 'city'
): string

export type AirportDirection = 'to_airport' | 'from_airport'

export declare const AIRPORT_DIRECTIONS: {
  readonly TO_AIRPORT: 'to_airport'
  readonly FROM_AIRPORT: 'from_airport'
}

export declare function normalizeAirportDirection(input: unknown): AirportDirection | null
export declare function formatAirportDirection(input: unknown, options?: { airportCode?: string }): string

export type AirlineInfo = {
  code: string
  name: string
  aliases: readonly string[]
}

export declare const COMMON_AIRLINES: readonly AirlineInfo[]

export type FlightDetails = {
  airline: string | null
  airlineCode: string | null
  flightNumber: string | null
  terminal: string | null
  direction: AirportDirection | null
  rawText?: string | null
}

export declare function parseFlightDetails(raw: unknown): FlightDetails | null
export declare function formatFlightSummary(flight: unknown): string
export declare function extractFlightFromNote(note: unknown): FlightDetails | null

export declare const AIRPORT_DEPOSIT_PERCENT: number
export declare const AIRPORT_DEPOSIT_LABEL: string
export declare const AIRPORT_REMAINING_LABEL: string
export declare const AIRPORT_SCHEDULE_NOTICE: string

export type AirportDepositSummary = {
  depositLabel: string
  remainingLabel: string
  depositPercent: number
  isStudent: boolean
  notice: string
  fareCents: number
  depositCents: number
  remainingCents: number
  studentDiscountCents: number
}

export declare function formatAirportDepositSummary(params?: {
  fareCents?: number
  depositCents?: number
  remainingCents?: number | null
  isStudent?: boolean
  studentDiscountCents?: number
}): AirportDepositSummary
