import { studentDiscountGranted } from '../../../src/lib/studentDomain.js'
import { authedJson } from 'rides-native/apiClient'
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
  return studentDiscountGranted(user)
}

export async function createScheduledTrip({
  user,
  pickup,
  dropoff,
  pickupAt,
  purpose,
  weekdays,
  tier = 'standard',
}: {
  user: AuthUser
  pickup: RidePlace
  dropoff: RidePlace
  pickupAt: Date | null
  purpose: SchedulePurpose
  weekdays: string[]
  tier?: 'standard' | 'tesla'
}) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (!user?.id) throw new Error('Sign in required to schedule a ride')
  const when = pickupAt ? pickupAt.toISOString() : null
  const data = await authedJson(supabase, '/api/stripe-payment-methods?action=schedule-trip', {
    method: 'POST',
    body: {
      pickup,
      dropoff,
      pickupAt: when,
      purpose,
      weekdays,
      tier,
    },
  }) as { trip: { id: string; status: string | null; pickup_at: string | null; pickup_label: string | null; dropoff_label: string | null } }
  if (!data?.trip?.id) throw new Error('Could not schedule ride')
  return data.trip
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
