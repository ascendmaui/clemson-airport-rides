import * as Location from 'expo-location'
import { useEffect, useRef, useState } from 'react'
import { authedJson } from 'rides-native/apiClient.js'
import { loadRiderFix } from 'rides-native/driverDesk.js'
import {
  isTripDismissed,
  loadDismissedPickupBeacons,
  persistDismissedPickupBeacon,
  pickupBeaconShouldShow,
  rememberDismissal,
} from '../../../shared/pickupBeacon.js'
import { authStorage } from '@/lib/storage'
import { supabase } from '@/lib/supabase'
import { quiet } from '@/lib/softFail'

type Point = { lat: number; lng: number }

type BeaconTrip = {
  id: string
  status: string | null
  pickup_lat: number | null
  pickup_lng: number | null
  metadata?: Record<string, unknown> | null
}

const OPEN_STATUSES = ['accepted', 'arriving', 'arrived'] as const

function finitePoint(lat: unknown, lng: unknown): Point | null {
  const latitude = Number(lat)
  const longitude = Number(lng)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  return { lat: latitude, lng: longitude }
}

function riderFromMetadata(metadata: Record<string, unknown> | null | undefined): Point | null {
  if (!metadata) return null
  const live = metadata.rider_location
  const bag = live && typeof live === 'object' ? live as Record<string, unknown> : metadata
  return finitePoint(bag.lat ?? bag.latitude ?? metadata.rider_lat, bag.lng ?? bag.longitude ?? metadata.rider_lng)
}

async function readCode(tripId: string): Promise<string | null> {
  if (!supabase) return null
  const row = await supabase.from('trip_pickup_codes').select('code').eq('trip_id', tripId).maybeSingle()
  if (!row.error && typeof row.data?.code === 'string') return row.data.code
  try {
    const data = await authedJson(supabase, `/api/pickup-beacon?tripId=${encodeURIComponent(tripId)}`)
    return typeof data?.pickupCode === 'string' ? data.pickupCode : null
  } catch {
    return null
  }
}

export function useDriverPickupBeacon(userId: string | null) {
  const [trip, setTrip] = useState<BeaconTrip | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [driver, setDriver] = useState<Point | null>(null)
  const [rider, setRider] = useState<Point | null>(null)
  const [dismissed, setDismissed] = useState<Record<string, true>>({})
  const [ready, setReady] = useState(false)
  const wasOpen = useRef(false)
  const tripId = trip?.id ?? null

  useEffect(() => {
    let alive = true
    loadDismissedPickupBeacons(authStorage).then((map) => {
      if (!alive) return
      setDismissed(map)
      setReady(true)
    }).catch(() => {
      if (alive) setReady(true)
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    wasOpen.current = false
    setCode(null)
    setRider(null)
  }, [tripId])

  useEffect(() => {
    if (!userId || !supabase) {
      setTrip(null)
      return undefined
    }
    const client = supabase
    let alive = true
    async function load() {
      const { data, error } = await client
        .from('trips')
        .select('id, status, pickup_lat, pickup_lng, metadata')
        .eq('driver_id', userId)
        .in('status', [...OPEN_STATUSES])
        .order('accepted_at', { ascending: false })
        .limit(1)
      if (!alive || error) return
      const row = Array.isArray(data) ? data[0] : data
      setTrip((row as BeaconTrip | undefined) || null)
    }
    void load()
    const channel = client
      .channel(`pickup-beacon-driver-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trips', filter: `driver_id=eq.${userId}` },
        () => { void load() },
      )
      .subscribe()
    const timer = setInterval(() => { void load() }, 4000)
    return () => {
      alive = false
      clearInterval(timer)
      void client.removeChannel(channel)
    }
  }, [userId])

  useEffect(() => {
    if (!tripId) return undefined
    let alive = true
    async function load() {
      const next = await readCode(tripId)
      if (alive) setCode(next)
    }
    void load()
    const timer = setInterval(() => { void load() }, 8000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [tripId])

  const dismissedHere = isTripDismissed(dismissed, tripId)
  const tracking = Boolean(tripId && ready && !dismissedHere)

  useEffect(() => {
    if (!tracking) return undefined
    let sub: Location.LocationSubscription | null = null
    let alive = true
    async function start() {
      try {
        const current = await Location.getForegroundPermissionsAsync()
        const granted = current.granted || (await Location.requestForegroundPermissionsAsync()).granted
        if (!alive || !granted) return
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 1 },
          (pos) => {
            if (!alive) return
            const next = finitePoint(pos.coords.latitude, pos.coords.longitude)
            if (next) setDriver(next)
          },
        )
        if (!alive) sub.remove()
      } catch {
        /* A missing fix keeps the beacon down. */
      }
    }
    void start()
    return () => {
      alive = false
      sub?.remove()
    }
  }, [tracking])

  useEffect(() => {
    if (!tracking || !tripId || !supabase) return undefined
    const client = supabase
    let alive = true
    async function pull() {
      const fix = await loadRiderFix(client, tripId)
      const fromShare = fix ? finitePoint(fix.latitude, fix.longitude) : null
      if (alive) setRider(fromShare || riderFromMetadata(trip?.metadata))
    }
    void pull()
    const timer = setInterval(() => { void pull() }, 4000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [tracking, trip?.metadata, tripId])

  const pickup = finitePoint(trip?.pickup_lat, trip?.pickup_lng)
  const show = ready && pickupBeaconShouldShow({
    status: trip?.status,
    code,
    dismissed: dismissedHere,
    wasOpen: wasOpen.current,
    driver,
    rider,
    pickup,
  })

  useEffect(() => {
    wasOpen.current = show
  }, [show])

  function dismiss() {
    if (!tripId) return
    setDismissed((prev) => rememberDismissal(prev, tripId))
    wasOpen.current = false
    void persistDismissedPickupBeacon(tripId, authStorage).catch(quiet('pickup beacon dismiss'))
  }

  return { show, code, tripId, dismiss }
}
