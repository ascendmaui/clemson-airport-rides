import { formatCents } from '../../../packages/rides-native/tripTags.js'

export function shownCents(cents: number, hidden: boolean): string {
  if (hidden) return '••••'
  return formatCents(cents)
}
