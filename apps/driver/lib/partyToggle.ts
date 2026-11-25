/**
 * Party-queue opt-in toggle: optimistic flip, visible revert on a failed save.
 * A failed *reload* after a successful save keeps the new value (the save landed).
 * Pure, so node tests drive it with fakes.
 */
export type PartyToggleResult = 'saved' | 'failed' | 'busy'

export async function toggleWithRevert<T>({
  current,
  next,
  apply,
  save,
  reload,
  onFail,
  onReloadFail,
  busy,
}: {
  current: T
  next: T
  apply: (value: T) => void
  save: () => Promise<unknown>
  reload?: () => Promise<T>
  onFail: (err: unknown) => void
  onReloadFail?: (err: unknown) => void
  busy?: { current: boolean }
}): Promise<PartyToggleResult> {
  if (busy?.current) return 'busy'
  if (busy) busy.current = true
  apply(next)
  try {
    try {
      await save()
    } catch (err) {
      apply(current)
      onFail(err)
      return 'failed'
    }
    if (reload) {
      try {
        apply(await reload())
      } catch (err) {
        onReloadFail?.(err)
      }
    }
    return 'saved'
  } finally {
    if (busy) busy.current = false
  }
}
