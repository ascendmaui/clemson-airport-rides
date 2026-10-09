export const RESUMABLE_STATUSES: readonly string[]
export type ResumableRow = {
  id: string
  status: string
  pickup_at?: string | null
  scheduled_for?: string | null
  accepted_at?: string | null
}
export function pickResumableTrip<T extends ResumableRow>(rows: T[] | null | undefined, now?: Date | number): T | null
export function shouldAutoResume(input: { tripId: string | null | undefined; pathname: string | null | undefined; handled?: { has(id: string): boolean } }): boolean
export function resumeAnnouncement(status: string | null | undefined): string
