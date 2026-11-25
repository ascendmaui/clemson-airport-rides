import { useEffect, useState, type ComponentProps } from 'react'
import { Marker } from 'react-native-maps'
import { MARKER_SETTLE_MS } from '@/lib/markerRedraw'

type Props = ComponentProps<typeof Marker> & {
  /** Changes whenever the custom view's look changes (colour, glyph, pattern). */
  lookKey: string
}

/**
 * A custom-view Marker that only redraws for a short window after its look
 * changes (tracksViewChanges true → false). Position updates still move it.
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
