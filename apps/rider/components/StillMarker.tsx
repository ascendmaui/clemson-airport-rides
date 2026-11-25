import { useEffect, useState, type ComponentProps } from 'react'
import { Marker } from 'react-native-maps'
import { MARKER_SETTLE_MS } from '@/lib/markerRedraw'

type Props = ComponentProps<typeof Marker> & {
  /** Changes whenever the custom view's look changes (colour, glyph, livery). */
  lookKey: string
}

/**
 * Custom-view marker that redraws for a short window after mount or a look
 * change, then sets tracksViewChanges false. Heading belongs on Marker
 * rotation so the frozen bitmap can still turn.
 */
export function StillMarker({ lookKey, children, ...rest }: Props) {
  const [tracking, setTracking] = useState(true)
  useEffect(() => {
    setTracking(true)
    const timer = setTimeout(() => setTracking(false), MARKER_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [lookKey])
  return (
    <Marker {...rest} tracksViewChanges={tracking}>
      {children}
    </Marker>
  )
}
