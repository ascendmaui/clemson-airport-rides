export type ArrivalWave = { airport: string; wave_start: string; wave_end: string; stage_at: string; flights: number; booked_pickups: number; score: number; data_quality: 'live' | 'scheduled' | 'rider_entered' }
export const STAGE_LEAD_MINUTES: number
export function riderFlightView(trip: unknown, status: string | null): { arrivals: boolean; code: string; line: string | null; waitingTitle: string | null; curbReadyAt: string | null } | null
export function waveCardLine(wave: ArrivalWave | null): { when: string; what: string; stage: string; quality: string } | null
export function loadArrivalWaves(supabase: unknown, airport?: string, hours?: number): Promise<ArrivalWave[]>
