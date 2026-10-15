/**
 * Flatten day-grouped lists into rows for a FlatList (virtualized) with sticky-free day headers.
 * Pure, so node tests cover keys and ordering.
 */
export type DayRow<T> =
  | { kind: 'day'; key: string; day: string; first: boolean }
  | { kind: 'item'; key: string; day: string; item: T }

export function dayRows<T extends { id: string }>(groups: [string, T[]][]): DayRow<T>[] {
  const rows: DayRow<T>[] = []
  groups.forEach(([day, items], index) => {
    if (!items.length) return
    rows.push({ kind: 'day', key: `day:${day}`, day, first: index === 0 })
    for (const item of items) rows.push({ kind: 'item', key: `item:${item.id}`, day, item })
  })
  return rows
}

/** Window sizes for driver lists: a few screens of cards, small batches to keep the JS thread free. */
export const DRIVER_LIST_WINDOW = { initialNumToRender: 6, maxToRenderPerBatch: 6, windowSize: 7, removeClippedSubviews: false } as const
