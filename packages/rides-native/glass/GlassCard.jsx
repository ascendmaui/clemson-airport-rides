import { GlassSurface } from './GlassSurface.jsx'

/** Frosted card. Renders GlassSurface, which mounts GlassView when Liquid Glass is available. */
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
