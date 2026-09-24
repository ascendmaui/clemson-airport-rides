import { formatCents } from 'rides-native/tripTags'

export function shownCents(cents: number, hidden: boolean): string {
  if (hidden) return '••••'
  return formatCents(cents)
}
