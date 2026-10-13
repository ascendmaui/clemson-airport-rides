import * as Location from 'expo-location'
import { useEffect, useRef, useState } from 'react'
import {
  approachAttention,
  approachDirection,
  approachStatusLine,
  formatApproachDistance,
  haversineMeters,
  isApproachStatus,
  type ApproachStage,
} from '@/lib/approachAlert'
import { supabase } from '@/lib/supabase'

type Coord = { lat: number; lng: number; heading?: number | null }

export function useDriverApproach(status: string | null, driverId: string | null, tripId: string | null = null) {
  const active = isApproachStatus(status)
  const [rider, setRider] = useState<Coord | null>(null)
  const [driver, setDriver] = useState<Coord | null>(null)
  const [denied, setDenied] = useState(false)
  const prevFeet = useRef<number | null>(null)
  const prevStage = useRef<ApproachStage | null>(null)

  useEffect(() => {
    prevFeet.current = null
    prevStage.current = null
    setDriver(null)
  }, [driverId, tripId])

  useEffect(() => {
    if (!active) return undefined
    let sub: Location.LocationSubscription | null = null
    let alive = true
    async function start() {
      try {
        const current = await Location.getForegroundPermissionsAsync()
        const granted = current.granted || (await Location.requestForegroundPermissionsAsync()).granted
        if (!alive) return
        if (!granted) {
          setDenied(true)
          return
        }
        setDenied(false)
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 1 },
          (pos: { coords: { latitude: number; longitude: number; heading?: number | null } }) => {
            if (!alive) return
            const lat = pos.coords.latitude
            const lng = pos.coords.longitude
            const heading = Number(pos.coords.heading)
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
            setRider({
              lat,
              lng,
              heading: Number.isFinite(heading) && heading >= 0 && heading < 360 ? heading : null,
            })
          },
        )
        if (!alive) sub.remove()
      } catch {
        if (alive) setDenied(true)
      }
    }
    void start()
    return () => {
      alive = false
      sub?.remove()
    }
  }, [active])

  useEffect(() => {
    if (!active || !driverId || !supabase) return undefined
    const client = supabase
    let alive = true
    let tripFix: Coord | null = null
    let statusFix: Coord | null = null
    function coordsOf(row: { lat?: unknown; lng?: unknown } | null | undefined): Coord | null {
      const lat = Number(row?.lat)
      const lng = Number(row?.lng)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
      return { lat, lng }
    }
    function publish() {
      if (!alive) return
      setDriver(tripFix || statusFix)
    }
    async function pull() {
      if (tripId) {
        const tripRes = await client
          .from('trip_driver_locations')
          .select('lat, lng')
          .eq('trip_id', tripId)
          .maybeSingle()
        if (!alive) return
        tripFix = tripRes.error ? null : coordsOf(tripRes.data)
      } else {
        tripFix = null
      }
      if (!tripFix) {
        const statusRes = await client
          .from('driver_status')
          .select('lat, lng')
          .eq('driver_id', driverId)
          .maybeSingle()
        if (!alive) return
        statusFix = statusRes.error ? statusFix : coordsOf(statusRes.data)
      }
      publish()
    }
    void pull()
    let channel = client.channel(`approach-driver-${tripId || 'open'}-${driverId}`)
    if (tripId) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trip_driver_locations', filter: `trip_id=eq.${tripId}` },
        () => { void pull() },
      )
    }
    channel = channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'driver_status', filter: `driver_id=eq.${driverId}` },
      () => { void pull() },
    )
    channel.subscribe()
    const timer = setInterval(() => { void pull() }, 8000)
    return () => {
      alive = false
      clearInterval(timer)
      void client.removeChannel(channel)
    }
  }, [active, driverId, tripId])

  const meters = rider && driver ? haversineMeters(rider.lat, rider.lng, driver.lat, driver.lng) : null
  const reading = formatApproachDistance(meters)
  const direction = approachDirection(rider, driver, rider?.heading)
  const feet = reading?.feet ?? null
  const previousFeet = feet == null ? null : prevFeet.current
  const previousStage = feet == null ? null : prevStage.current

  const attention = feet == null ? null : approachAttention({ previousFeet, feet, previousStage })

  useEffect(() => {
    if (!active || feet == null) {
      prevFeet.current = null
      prevStage.current = null
      return
    }
    prevFeet.current = feet
    prevStage.current = attention?.stage ?? null
  }, [active, attention?.stage, feet])

  let waiting: string | null = null
  if (!driverId) waiting = 'Waiting for your driver'
  else if (!driver) waiting = "Waiting for your driver's location"
  else if (denied && !rider) waiting = 'Turn on location to see the distance'
  else if (!rider) waiting = 'Finding you…'
  else if (!reading) waiting = 'Updating distance…'

  return {
    active,
    reading,
    direction,
    attention,
    statusLine: approachStatusLine(attention?.stage ?? null, Boolean(attention?.decreasing), feet),
    waiting,
  }
}
