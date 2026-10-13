import { authedJson } from 'rides-native/apiClient'
import { supabase } from '@/lib/supabase'

export type ForecastSlot = {
  zone: string
  zoneLabel: string
  startsAt: string
  endsAt: string
  localDate: string
  localHour: number
  expectedCentsPerHour: number
  samples: number
  confidence: 'low' | 'medium' | 'high'
  reasons: string[]
}

export type Forecast = {
  generatedAt: string
  lowData: boolean
  tripsUsed: number
  disclaimer: string
  top: ForecastSlot[]
  bestByDay: ForecastSlot[]
  events: { title: string; event_date: string; starts_at: string | null; zone: string }[]
  eventsNote: string | null
}

let cached: { at: number; data: Forecast } | null = null

export async function loadForecast(force = false): Promise<Forecast> {
  if (!force && cached && Date.now() - cached.at < 10 * 60_000) return cached.data
  const data = (await authedJson(supabase, '/api/driver?action=forecast')) as Forecast
  if (!data?.top) throw new Error('Forecast unavailable')
  cached = { at: Date.now(), data }
  return data
}

export function dollarsPerHour(cents: number) {
  return `$${Math.round(cents / 100)}/hr`
}
