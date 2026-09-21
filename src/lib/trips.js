import { supabase } from './supabase'
import { STADIUM } from '../components/CampusMap'

export async function requestDriverTrip({
  riderId,
  driverId,
  dest = 'GSP Airport',
  destLat = 34.8956,
  destLng = -82.2189,
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
      tier: 'standard',
      pickup_label: 'Memorial Stadium',
      dropoff_label: dest,
      pickup_lat: STADIUM[0],
      pickup_lng: STADIUM[1],
      dropoff_lat: destLat,
      dropoff_lng: destLng,
      passengers: 1,
    })
    .select('id, status, driver_id, dropoff_label')
    .single()

  if (error) throw new Error(error.message || 'Could not request trip')
  return data
}
