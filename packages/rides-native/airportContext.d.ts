export type AirportContext = {
  code: 'GSP' | 'CLT' | 'ATL'
  name: string
  direction: 'to' | 'from'
  curb: 'Departures' | 'Arrivals'
  terminal: string | null
  airline: string | null
  flightNumber: string | null
  flightTime: string | null
  chip: string
  flightLine: string | null
  line: string
}
export type Flight = { number: string | null; airlineCode: string | null; airline: string | null; time: string | null }
export const AIRLINES: Record<string, string>
export const FLIGHT_NUMBER_HINT: string
export const FLIGHT_TIME_HINT: string
export function airportTripContext(trip: unknown): AirportContext | null
export function normalizeFlight(input: unknown): { flight?: Flight | null; error?: string; code?: string }
export function tripFlight(trip: unknown): (Flight & { terminal: string | null }) | null
