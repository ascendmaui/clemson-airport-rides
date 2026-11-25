/**
 * Rows for rider FlatLists. Pure so node tests can check keys and order.
 * Window sizes keep the first paint small on schedule, history, friends, and pick-driver.
 */
export const RIDER_LIST_WINDOW = {
  initialNumToRender: 8,
  maxToRenderPerBatch: 8,
  windowSize: 7,
  removeClippedSubviews: false,
} as const

export function upcomingScheduleRows<T extends { id: string; status?: string | null }>(rows: T[]): T[] {
  return rows.filter((row) => row.status !== 'canceled')
}

export type PickerListRow<T> =
  | { kind: 'section'; key: string; title: string }
  | { kind: 'driver'; key: string; driver: T }

/** Section titles show only when more than one group has drivers, matching the old roster. */
export function pickerListRows<T extends { id: string }>(
  blocks: { title: string; rows: T[] }[],
): PickerListRow<T>[] {
  const showTitles = blocks.length > 1
  const out: PickerListRow<T>[] = []
  for (const block of blocks) {
    if (showTitles) out.push({ kind: 'section', key: `section:${block.title}`, title: block.title })
    for (const driver of block.rows) out.push({ kind: 'driver', key: `driver:${driver.id}`, driver })
  }
  return out
}

export type FriendScreenRow =
  | { kind: 'friend'; key: string; id: string }
  | { kind: 'ride-together'; key: 'ride-together' }
  | { kind: 'activity-head'; key: 'activity-head' }
  | { kind: 'activity'; key: string; id: string }

/** Saved friends, then the ride-together card, then activity. Stable keys for FlatList. */
export function friendScreenRows(
  friends: { id: string }[],
  activity: { id: string }[],
): FriendScreenRow[] {
  return [
    ...friends.map((friend) => ({ kind: 'friend' as const, key: `friend:${friend.id}`, id: friend.id })),
    { kind: 'ride-together', key: 'ride-together' },
    { kind: 'activity-head', key: 'activity-head' },
    ...activity.map((row) => ({ kind: 'activity' as const, key: `activity:${row.id}`, id: row.id })),
  ]
}
