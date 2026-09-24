import { downtownNow, previewDate, resolveDemandRange, typicalSpots } from 'rides-native/heat.js'
import { supabase } from '@/lib/supabase'

export type BusySpot = {
  id: string
  name: string
  lat: number
  lng: number
  radius: number
  intensity: number
}

type DemandRow = {
  lat?: number
  lng?: number
  weight?: number
  request_count?: number
}

export async function loadBusySpots(windowId: string) {
  const when = previewDate(windowId)
  const snap = downtownNow(when)
  const typical = typicalSpots(when) as BusySpot[]
  let caption = `Popular campus spots from ride requests — dorms, downtown, stadium. College Ave feels ${snap.label.toLowerCase()}.`
  let blended = false
  let spots = typical

  if (supabase) {
    const { from, to, hourStart, hourEnd } = resolveDemandRange(windowId)
    const { data, error } = await supabase.rpc('get_ride_demand', {
      p_from: from.toISOString(),
      p_to: to.toISOString(),
      p_hour_start: hourStart,
      p_hour_end: hourEnd,
    })
    if (!error && Array.isArray(data) && data.length) {
      const live = (data as DemandRow[])
        .map((row, index) => {
          const weight = Number(row.weight) || Number(row.request_count) || 1
          const intensity = Math.min(1, weight / 8)
          return {
            id: `live-${index}`,
            name: 'Live request',
            lat: Number(row.lat),
            lng: Number(row.lng),
            radius: 70 + intensity * 60,
            intensity,
          }
        })
        .filter((spot) => Number.isFinite(spot.lat) && Number.isFinite(spot.lng))
      if (live.length) {
        spots = [...live, ...typical]
        blended = true
        caption = `Live + typical — College Ave feels ${snap.label.toLowerCase()} for this hour`
      }
    }
  }

  return { spots, caption, blended, label: snap.label }
}
