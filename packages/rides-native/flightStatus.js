/** Rider and driver app access to shared/flightStatus.js. */
export { riderFlightView, waveCardLine, STAGE_LEAD_MINUTES } from '../../shared/flightStatus.js'

/** Upcoming arrival waves for the driver card (RPC is driver/admin only). Never throws. */
export async function loadArrivalWaves(supabase, airport = 'GSP', hours = 3) {
  if (!supabase) return []
  const { data, error } = await supabase.rpc('airport_arrival_waves', { p_airport: airport, p_hours: hours })
  return error || !Array.isArray(data) ? [] : data
}
