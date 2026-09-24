import type { CarpoolQuote, Place } from './carpool.js'

export type MatchPool = {
  waiting?: boolean
  neighborhoodLabel?: string | null
  neighborhoodId?: string | null
  size?: number
  openSeats?: number
  riders?: { firstName?: string; neighborhood?: string }[]
}

export type MatchResult = {
  ok?: boolean
  queue?: boolean
  code?: string
  message?: string
  token?: string | null
  rideId?: string | null
  urlPath?: string | null
  error?: string
  pool?: MatchPool | null
}

export type GroupResult = {
  token: string
  rideId?: string
  urlPath?: string
  quote?: CarpoolQuote | null
  recomputeError?: string | null
}

export type OfferResult = {
  token: string
  urlPath?: string
  maxParticipants?: number
  vehicleLabel?: string | null
}

export type RideParticipant = {
  id: string
  display_name: string
  status?: string
  fare_cents?: number | null
  pickup?: Place | null
  dropoff?: Place | null
  user_id?: string | null
  is_self?: boolean
  student_verified_at?: string | null
  rating_avg?: number | null
  rating_count?: number | null
  email?: string | null
}

export type RideSummary = {
  id?: string
  token?: string
  status?: string
  kind?: string
  max_participants?: number | null
  vehicle_label?: string | null
  split_mode?: 'even' | 'by_distance' | string
  distance_m?: number | null
  duration_s?: number | null
  total_fare_cents?: number | null
  fare_breakdown?: {
    carpool?: CarpoolQuote
    match_mode?: string
    party_type?: string
    ambassador_code?: string | null
    friend_quote?: {
      id?: string
      ride_id?: string
      signature?: string | null
      participant_set?: string
      created_at?: string
      expires_at?: string
      shares?: { id: string; share_cents: number }[]
    } | null
  } | null
  trip_id?: string | null
  driver_profile_id?: string | null
  is_organizer?: boolean
  organizer_id?: string | null
  participants?: RideParticipant[]
}

export type FirstRideStatus = {
  eligible?: boolean
  alreadyUsed?: boolean
  windowOpen?: boolean
  completedTrips?: number
  schemaMissing?: boolean
}

export type ConfirmResult = {
  status?: string
  reason?: string | null
  quoteId?: string | null
  quoteSignature?: string | null
  shares?: { id: string; share_cents: number }[]
  booked?: boolean
  trip?: { id?: string; driver_id?: string | null; status?: string } | null
  paymentElementSecrets?: unknown[]
  ride?: RideSummary
  bookReason?: string | null
}

type SupabaseAuth = {
  auth: {
    getSession: () => Promise<{ data: { session: { access_token?: string } | null } }>
  }
} | null

export function setCarpoolApiBase(base: string | undefined): void
export function apiBase(): string
export function inviteUrl(token: string, kind?: 'carpool' | 'friends'): string
export function apiErrorMessage(err: unknown): string
export function matchCarpool(
  supabase: SupabaseAuth,
  body: { pickup: Place; dropoff: Place; displayName?: string; partyType?: string; departAt?: string; ambassadorCode?: string },
): Promise<MatchResult>
export function createCarpoolGroup(
  supabase: SupabaseAuth,
  body: { pickup: Place; dropoff: Place; displayName?: string; partyType?: string; ambassadorCode?: string },
): Promise<GroupResult>
export function claimAmbassadorAttribution(
  supabase: SupabaseAuth,
  code: string,
): Promise<{ ok?: boolean; code?: string; code_type?: string; stored?: boolean; error?: string }>
export function carpoolProgram(supabase: SupabaseAuth, action: 'first_ride' | 'ambassador'): Promise<FirstRideStatus>
export function createCarpoolOffer(
  supabase: SupabaseAuth,
  body: { displayName?: string; pickup: Place; dropoff: Place; splitMode?: string; partyType?: string; ambassadorCode?: string },
): Promise<OfferResult>
export function getFriendRide(supabase: SupabaseAuth, token: string): Promise<RideSummary>
export function joinFriendRide(
  supabase: SupabaseAuth,
  body: { token: string; displayName?: string; email?: string; pickup: Place; dropoff: Place; ambassadorCode?: string },
): Promise<{ ride?: RideSummary }>
export function recomputeFriendRide(supabase: SupabaseAuth, token: string, splitMode?: string): Promise<RideSummary>
export function confirmFriendCharges(
  supabase: SupabaseAuth,
  token: string,
  quote?: { quoteId?: string | null; quoteSignature?: string | null } | null,
): Promise<ConfirmResult>
