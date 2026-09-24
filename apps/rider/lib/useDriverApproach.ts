import * as Location from 'expo-location'
import { useEffect, useRef, useState } from 'react'
import {
  approachAttention,
  approachStatusLine,
  formatApproachDistance,
  haversineMeters,
  isApproachStatus,
} from '@/lib/approachAlert'
import { supabase } from '@/lib/supabase'

type Coord = { lat: number; lng: number }

export function useDriverApproach(status: string | null, driverId: string | null) {
  const active = isApproachStatus(status)
  const [rider, setRider] = useState<Coord | null>(null)
  const [driver, setDriver] = useState<Coord | null>(null)
  const [denied, setDenied] = useState(false)
  const prevFeet = useRef<number | null>(null)

  useEffect(() => {
    prevFeet.current = null
    setDriver(null)
  }, [driverId])

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
          { accuracy: Location.Accuracy.High, timeInterval: 2000, distanceInterval: 5 },
          (pos) => {
            if (!alive) return
            const lat = pos.coords.latitude
            const lng = pos.coords.longitude
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
            setRider({ lat, lng })
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
    let alive = true
    async function pull() {
      const { data, error } = await supabase!
        .from('driver_status')
        .select('lat, lng')
        .eq('driver_id', driverId)
        .maybeSingle()
      if (!alive || error || !data) return
      const lat = Number(data.lat)
      const lng = Number(data.lng)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
      setDriver({ lat, lng })
    }
    void pull()
    const timer = setInterval(() => {
      void pull()
    }, 2000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [active, driverId])

  const meters = rider && driver ? haversineMeters(rider.lat, rider.lng, driver.lat, driver.lng) : null
  const reading = formatApproachDistance(meters)
  const feet = reading?.feet ?? null
  const previousFeet = feet == null ? null : prevFeet.current

  useEffect(() => {
    prevFeet.current = feet
  }, [feet])

  const attention = feet == null ? null : approachAttention({ previousFeet, feet })

  let waiting: string | null = null
  if (!driverId) waiting = 'Waiting for your driver'
  else if (!driver) waiting = "Waiting for your driver's location"
  else if (denied && !rider) waiting = 'Turn on location to see the distance'
  else if (!rider) waiting = 'Finding you…'
  else if (!reading) waiting = 'Updating distance…'

  return {
    active,
    reading,
    attention,
    statusLine: approachStatusLine(attention?.stage ?? null, Boolean(attention?.decreasing)),
    waiting,
  }
}
