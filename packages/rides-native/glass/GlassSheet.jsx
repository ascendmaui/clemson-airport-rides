import { GlassSurface } from './GlassSurface.jsx'

/** Bottom sheet shell: top radii, heavier blur, same specular streak and rim. */
export function GlassSheet({
  children,
  app = 'rider',
  scheme = 'light',
  accent,
  style,
  accessibilityRole,
  accessibilityLabel,
  accessibilityState,
  pointerEvents,
}) {
  return (
    <GlassSurface
      app={app}
      scheme={scheme}
      variant="sheet"
      accent={accent}
      edges="top"
      style={style}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
      pointerEvents={pointerEvents}
    >
      {children}
    </GlassSurface>
  )
}
