export type CampusEventCard = { id: string; kind: string; label: string; title: string; day: string; bonus: string | null }
export const EVENT_KIND_LABELS: Record<string, string>
export const CAMPUS_EVENT_COLUMNS: string
export function upcomingEvents(events: unknown[], now?: Date, days?: number): CampusEventCard[]
export function activeBonusWindow(events: unknown[], now?: Date): { event: unknown; cents: number; line: string | null } | null
export function eventDemandWeight(events: unknown[], at?: Date): number
export function nudgeCopy(event: unknown): { title: string; body: string }
export function bonusLine(event: unknown): string | null
export function loadCampusEvents(supabase: unknown, opts?: { now?: Date; days?: number }): Promise<{ events: CampusEventCard[]; bonus: { cents: number; line: string | null } | null }>
