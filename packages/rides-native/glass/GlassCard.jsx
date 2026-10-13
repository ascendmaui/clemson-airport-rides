import { GlassSurface } from './GlassSurface.jsx'

/** Frosted card. Body copy uses the recipe ink so it stays readable on both map styles. */
export function GlassCard({
  children,
  app = 'rider',
  scheme = 'light',
  accent,
  style,
  selected = false,
  accessibilityRole,
  accessibilityLabel,
  accessibilityState,
  pointerEvents,
}) {
  return (
    <GlassSurface
      app={app}
      scheme={scheme}
      variant="surface"
      accent={accent}
      style={style}
      selected={selected}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
      pointerEvents={pointerEvents}
    >
      {children}
    </GlassSurface>
  )
}
