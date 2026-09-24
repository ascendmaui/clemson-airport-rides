export const SIGNUP_PROFILE_DRAFT_KEY: string
export const RIDE_STYLES: readonly string[]
export const PARTY_VISIBLE_STATUSES: readonly string[]

export type ProfileDraft = {
  full_name?: string | null
  phone?: string | null
  bio?: string | null
  ride_style?: string | null
  rating_avg?: number | null
  rating_count?: number | null
  favorite_spots?: string[] | null
  student_verified_at?: string | null
  avatar_url?: string | null
}

export type SignupDraft = {
  fullName: string
  phone: string
  bio: string
  rideStyle: string
  promo: string
}

export type PartyTrip = {
  status?: string | null
  rider_id?: string | null
  driver_id?: string | null
  pickup_label?: string | null
  dropoff_label?: string | null
  id?: string
}

export type CounterpartView = {
  id: string
  name: string
  initial: string
  ratingLine: string
  ratingAvg: number | null
  ratingCount: number
  bio: string
  rideStyle: string
  spots: string[]
  phone: string
  student: boolean
  vehicle: string
  roleLabel: string
}

export function digits(value: unknown): string
export function formatPhone(value: unknown): string
export function hasRideStyle(value: unknown): boolean
export function missingProfileFields(profile: ProfileDraft | null | undefined): string[]
export function isProfileComplete(profile: ProfileDraft | null | undefined): boolean
export function profileFieldError(profile: ProfileDraft | null | undefined): string | null
export function profileRowFromUser(user: { user_metadata?: Record<string, unknown> } | null | undefined): Record<string, string>
export function signupProfileMetadata(input?: {
  fullName?: string
  phone?: string
  bio?: string
  rideStyle?: string
  promoCode?: string
}): Record<string, string>
export function readSignupDraft(raw: string | null | undefined): SignupDraft | null
export function userWithDraft<T extends { user_metadata?: Record<string, unknown> }>(user: T, draft: SignupDraft | null): T
export function buildEnsureProfilePatch(
  existing: ProfileDraft & { id?: string; student_verified_at?: string | null } | null,
  user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> },
  now: string,
  clemson: boolean,
): Record<string, string | null>
export function shouldRedirectToProfileSetup(input: { signedIn: boolean; complete: boolean; segment?: string }): boolean
export function shouldLeaveProfileSetup(input: { signedIn: boolean; complete: boolean; segment?: string }): boolean
export function counterpartId(trip: PartyTrip | null | undefined, userId: string | null | undefined): string | null
export function ratingBlockReason(trip: PartyTrip | null | undefined, userId: string | null | undefined): string | null
export function validateStars(stars: unknown): string | null
export function formatRatingLine(avg: number | null | undefined, count: number | null | undefined): string
export function asSpotList(value: unknown): string[]
export function vehicleLabelFromRow(vehicle: unknown): string
export function toCounterpartView(
  profile: (ProfileDraft & { id: string; full_name?: string | null; vehicle?: unknown }) | null,
  options?: { viewerIsRider?: boolean },
): CounterpartView | null
export function loadOwnProfile(supabase: unknown, userId: string): Promise<ProfileDraft | null>
export function loadPublicProfile(supabase: unknown, profileId: string): Promise<ProfileDraft | null>
export function saveOwnProfile(supabase: unknown, userId: string, draft: ProfileDraft): Promise<ProfileDraft>
export function loadCounterpart(supabase: unknown, trip: PartyTrip, userId: string): Promise<CounterpartView | null>
export function fetchTripForRating(supabase: unknown, tripId: string): Promise<PartyTrip | null>
export function hasRatedTrip(supabase: unknown, tripId: string, raterId: string): Promise<boolean>
export function submitPartyRating(
  supabase: unknown,
  input: { tripId: string; raterId: string; stars: number; comment?: string },
): Promise<{ id: string; stars: number }>
export function findPendingRating(supabase: unknown, userId: string): Promise<PartyTrip | null>
