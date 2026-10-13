import { GlassSurface } from './GlassSurface.jsx'

/** Frosted card. Renders GlassSurface, which mounts GlassView when Liquid Glass is available. */
export function GlassCard({
  children,
  app = 'rider',
  scheme = 'light',
  accent,
  style,
  selected = false,
  variant = 'surface',
  accessibilityRole,
  accessibilityLabel,
  accessibilityState,
  pointerEvents,
}) {
  return (
    <GlassSurface
      app={app}
      scheme={scheme}
      variant={variant === 'offer' ? 'offer' : 'surface'}
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
