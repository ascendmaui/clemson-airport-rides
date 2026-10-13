export const QUIET_TIME_ZONE: string
export function parseHhmm(value: unknown): number | null
export function formatHhmm(minutes: number): string
export function hhmmLabel(value: string): string
export function minutesInZone(now?: Date, timeZone?: string): number
export function inWindow(nowMinutes: number, startMinutes: number, endMinutes: number): boolean
export function isQuietAt(quiet: { dnd?: boolean; scheduleEnabled?: boolean; start?: string; end?: string } | null | undefined, now?: Date): boolean
