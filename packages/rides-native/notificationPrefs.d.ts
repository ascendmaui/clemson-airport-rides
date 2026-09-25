export type QuietPrefs = {
  dnd: boolean
  scheduleEnabled: boolean
  start: string
  end: string
}

export type NotificationPrefs = {
  ride: boolean
  billing: boolean
  friends: boolean
  promotions: boolean
  system: boolean
  quiet: QuietPrefs
  dndNewRequestTones: boolean
}

export type PrefsStorage = {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
}

export const NOTIFICATION_CATEGORIES: { id: string; label: string; hint: string }[]
export const DEFAULT_QUIET: QuietPrefs
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs

export function quietFromPrefs(raw: unknown): QuietPrefs
export function normalizePrefs(raw: unknown): NotificationPrefs
export function readLocalPrefs(storage: PrefsStorage | null | undefined, userId: string | null | undefined): Promise<NotificationPrefs>
export function writeLocalPrefs(storage: PrefsStorage | null | undefined, userId: string | null | undefined, prefs: NotificationPrefs): Promise<void>
export function fetchNotificationPrefs(
  supabase: unknown,
  storage: PrefsStorage | null | undefined,
  userId: string | null | undefined,
): Promise<{ prefs: NotificationPrefs; persisted: boolean; softFail: string | null }>
export function saveNotificationPrefs(
  supabase: unknown,
  storage: PrefsStorage | null | undefined,
  userId: string | null | undefined,
  next: unknown,
): Promise<{ ok: boolean; persisted: boolean; softFail: string | null; prefs: NotificationPrefs }>
