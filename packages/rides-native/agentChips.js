import {
  HELP_CHIPS,
  SUPPORT_CHIPS,
  categoryLabel as labelRawCategory,
} from '../../server/agentChips.js'

export { HELP_CHIPS, SUPPORT_CHIPS }

// Trim strings before the server lookup so padded keys still match and a
// whitespace-only category does not render as a blank label.
export function categoryLabel(category) {
  const value = typeof category === 'string' ? category.trim() : category
  return labelRawCategory(value)
}
