export function useGameDayExperience(
  supabase: unknown,
  options?: { driverId?: string | null },
): {
  model: any
  ready: boolean
  togglePrep: (itemId: string) => void
}
