/**
 * Sign-in surfaces stay on the light stylesheet unless a screen passes a palette.
 * Title and links use the palette link token, which clears WCAG AA on both cards.
 */
export function authToneFromPalette(colors) {
  if (!colors || typeof colors !== 'object') return null
  return {
    background: colors.background,
    card: colors.card,
    elevated: colors.elevated,
    title: colors.link,
    body: colors.inkSecondary,
    ink: colors.ink,
    link: colors.link,
    placeholder: colors.placeholder,
    input: colors.input,
    border: colors.border,
    orange: colors.orange,
    onAccent: colors.onAccent,
    danger: colors.danger,
    shadow: colors.shadow,
  }
}

export function authToneStyle(tone, role) {
  if (!tone) return null
  switch (role) {
    case 'screen':
      return { backgroundColor: tone.background }
    case 'card':
      return { backgroundColor: tone.card, borderColor: tone.border, shadowColor: tone.shadow }
    case 'back':
      return { backgroundColor: tone.elevated }
    case 'title':
      return { color: tone.title }
    case 'body':
      return { color: tone.body }
    case 'ink':
      return { color: tone.ink }
    case 'link':
      return { color: tone.link }
    case 'input':
      return { color: tone.ink, backgroundColor: tone.input, borderColor: tone.border }
    case 'social':
      return { backgroundColor: tone.elevated, borderColor: tone.border }
    case 'primary':
      return { backgroundColor: tone.orange }
    case 'onAccent':
      return { color: tone.onAccent }
    case 'danger':
      return { color: tone.danger }
    default:
      return null
  }
}
