import { supabase } from './supabase'
import { STADIUM } from '../components/CampusMap'
import { RIDE_TIERS } from '../../packages/rides-native/places.js'
import { preferredTripFields } from '../../packages/rides-native/drivers.js'
import { studentTripMeta } from '../../packages/rides-native/riderMoney.js'

export async function requestDriverTrip({
  riderId,
  driverId,
  dest = 'GSP Airport',
  destLat = 34.8956,
  destLng = -82.2189,
  tier = 'standard',
  isStudent = false,
  listCents = 0,
}) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (!riderId) throw new Error('Sign in required to request a driver')
  if (!driverId) throw new Error('Select a driver first')

  const { data, error } = await supabase
    .from('trips')
    .insert({
      rider_id: riderId,
      driver_id: driverId,
      status: 'requested',
      tier: tier || 'standard',
      pickup_label: 'Memorial Stadium',
      dropoff_label: dest,
      pickup_lat: STADIUM[0],
      pickup_lng: STADIUM[1],
      dropoff_lat: destLat,
      dropoff_lng: destLng,
      passengers: 1,
      metadata: {
        ...studentTripMeta({
          isStudent,
          tier: tier || 'standard',
          fareCents: Math.max(
            0,
            Math.round(Number(listCents) || 0) || Math.round((Number(RIDE_TIERS.find((row) => row.id === (tier || 'standard'))?.price) || 0) * 100),
          ),
        }),
        ...preferredTripFields(driverId),
      },
    })
    .select('id, status, driver_id, dropoff_label')
    .single()

  if (error) throw new Error(error.message || 'Could not request trip')
  return data
}
