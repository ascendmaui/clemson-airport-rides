import { displayFirstName, isClemsonEmail } from 'rides-native/authErrors'
import type { AuthUser } from 'rides-native/createAuth'
import {
  airportFareCents,
  applyStudentDiscount,
  depositCents,
  distanceFareCents,
  haversineMeters,
} from 'rides-native/riderShell.js'
import { supabase } from '@/lib/supabase'

export type RidePlace = { label: string; lat: number; lng: number }

export type SchedulePurpose = 'early_class' | 'airport' | 'planned' | 'party_weekend' | 'recurring'

export type RideQuote = {
  fareCents: number
  discountCents: number
  label: string | null
  depositCents: number
  estimate: boolean
  airport: 'GSP' | 'CLT' | null
  miles: number | null
}

export type ScheduledRow = {
  id: string
  status: string | null
  pickup_label: string | null
  dropoff_label: string | null
  fare_cents: number | null
  deposit_cents: number | null
  pickup_at: string | null
  scheduled_for: string | null
  rider_note: string | null
  tier: string | null
  metadata: { purpose?: string; recurrence?: { weekdays?: string[] }; fare_is_estimate?: boolean } | null
}

function airportCode(label: string): 'GSP' | 'CLT' | null {
  if (/gsp|greenville/i.test(label)) return 'GSP'
  if (/\bclt\b|charlotte/i.test(label)) return 'CLT'
  return null
}

export function quoteRide(pickup: RidePlace, dropoff: RidePlace, isStudent: boolean): RideQuote {
  const airport = airportCode(dropoff.label)
  if (airport) {
    const raw = airportFareCents(airport) || 0
    const student = applyStudentDiscount(raw, isStudent)
    return {
      ...student,
      depositCents: depositCents(student.fareCents),
      estimate: false,
      airport,
      miles: null,
    }
  }
  const meters = haversineMeters(pickup, dropoff) || 0
  const student = applyStudentDiscount(distanceFareCents(meters), isStudent)
  return {
    ...student,
    depositCents: 0,
    estimate: true,
    airport: null,
    miles: Math.round((meters / 1609.344) * 10) / 10,
  }
}

export function riderIsStudent(user: AuthUser | null) {
  return Boolean(user?.email && isClemsonEmail(user.email))
}

export async function createScheduledTrip({
  user,
  pickup,
  dropoff,
  pickupAt,
  purpose,
  weekdays,
  quote,
  tier = 'standard',
}: {
  user: AuthUser
  pickup: RidePlace
  dropoff: RidePlace
  pickupAt: Date | null
  purpose: SchedulePurpose
  weekdays: string[]
  quote: RideQuote
  tier?: 'standard' | 'tesla'
}) {
  if (!supabase) throw new Error('Supabase is not configured')
  const when = pickupAt ? pickupAt.toISOString() : null
  const metadata = {
    kind: when ? 'scheduled' : 'airport',
    purpose,
    rider_first_name: displayFirstName(
      user.user_metadata?.full_name || user.email?.split('@')[0],
      'Rider',
    ),
    fare_is_estimate: quote.estimate,
    reminders: {},
    isStudent: Boolean(quote.label),
    student_discount_cents: quote.discountCents,
    studentLabel: quote.label,
    recurrence: purpose === 'recurring' ? { interval: 'weekly', weekdays } : null,
    party: purpose === 'party_weekend' ? 'weekend' : null,
    tesla: tier === 'tesla',
    fleet: tier === 'tesla' ? 'tesla_model_3' : 'standard',
  }
  const { data, error } = await supabase
    .from('trips')
    .insert({
      rider_id: user.id,
      status: when ? 'scheduled' : 'searching',
      tier: tier === 'tesla' ? 'tesla' : 'standard',
      pickup_label: pickup.label,
      dropoff_label: dropoff.label,
      pickup_lat: pickup.lat,
      pickup_lng: pickup.lng,
      dropoff_lat: dropoff.lat,
      dropoff_lng: dropoff.lng,
      fare_cents: quote.fareCents,
      deposit_cents: quote.depositCents,
      passengers: 1,
      pickup_at: when,
      scheduled_for: when,
      rider_note: purpose,
      metadata,
    })
    .select('id, status, pickup_at, pickup_label, dropoff_label')
    .single()
  if (error) throw new Error(error.message || 'Could not schedule ride')
  return data
}

export async function listScheduledTrips(riderId: string) {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('trips')
    .select('id, status, pickup_label, dropoff_label, fare_cents, deposit_cents, pickup_at, scheduled_for, rider_note, tier, metadata')
    .eq('rider_id', riderId)
    .not('pickup_at', 'is', null)
    .order('pickup_at', { ascending: true })
    .limit(30)
  if (error) throw new Error(error.message)
  return (data || []) as ScheduledRow[]
}

export async function cancelScheduledTrip(tripId: string) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await supabase
    .from('trips')
    .update({ status: 'canceled', canceled_at: new Date().toISOString() })
    .eq('id', tripId)
    .in('status', ['scheduled', 'accepted'])
  if (error) throw new Error(error.message || 'Could not cancel')
}
