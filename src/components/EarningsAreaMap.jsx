import { Circle, GoogleMap, Marker, useJsApiLoader } from '@react-google-maps/api'
import { mapsLoaderOptions } from '../lib/googleMapsLoader'

const ORANGE = '#F56600'
const PURPLE = '#522D80'
const AREA_RADIUS_M = 900

function pinIcon(color) {
  const s = 18
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"><circle cx="${s / 2}" cy="${s / 2}" r="${s / 2 - 2}" fill="${color}" stroke="#fff" stroke-width="3"/></svg>`
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: typeof window !== 'undefined' && window.google?.maps ? new window.google.maps.Size(s, s) : undefined,
    anchor: typeof window !== 'undefined' && window.google?.maps ? new window.google.maps.Point(s / 2, s / 2) : undefined,
  }
}

function FallbackAreas({ height }) {
  return (
    <div
      style={{
        height,
        borderRadius: 16,
        position: 'relative',
        overflow: 'hidden',
        background: 'linear-gradient(145deg, rgba(245,102,0,0.16), rgba(82,45,128,0.2))',
      }}
    >
      <span style={{ position: 'absolute', left: '28%', top: '58%', width: 18, height: 18, borderRadius: '50%', background: ORANGE, boxShadow: '0 0 0 14px rgba(245,102,0,0.18)' }} />
      <span style={{ position: 'absolute', left: '64%', top: '34%', width: 16, height: 16, borderRadius: '50%', background: PURPLE, boxShadow: '0 0 0 14px rgba(82,45,128,0.18)' }} />
    </div>
  )
}

/**
 * Neighborhood pins only. Callers must pass approximateLatLng results, never exact stops.
 */
export function EarningsAreaMap({ pickup, dropoff, height = 168 }) {
  const apiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim()
  const { isLoaded, loadError } = useJsApiLoader(mapsLoaderOptions(apiKey))
  const points = [pickup, dropoff].filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng))
  const center = points.length
    ? {
        lat: points.reduce((sum, p) => sum + p.lat, 0) / points.length,
        lng: points.reduce((sum, p) => sum + p.lng, 0) / points.length,
      }
    : { lat: 34.68, lng: -82.84 }

  if (!points.length) return null
  if (!apiKey || loadError || !isLoaded || typeof window === 'undefined') {
    return <FallbackAreas height={height} />
  }

  const orange = pinIcon(ORANGE)
  const purple = pinIcon(PURPLE)

  return (
    <div style={{ height, borderRadius: 16, overflow: 'hidden' }}>
      <GoogleMap
        mapContainerStyle={{ height: '100%', width: '100%' }}
        center={center}
        zoom={12}
        onLoad={(map) => {
          if (points.length < 2 || !window.google?.maps) return
          const bounds = new window.google.maps.LatLngBounds()
          points.forEach((p) => bounds.extend(p))
          map.fitBounds(bounds, 36)
        }}
        options={{
          disableDefaultUI: true,
          gestureHandling: 'none',
          clickableIcons: false,
          keyboardShortcuts: false,
        }}
      >
        {pickup && (
          <>
            <Circle center={pickup} radius={AREA_RADIUS_M} options={{ strokeWeight: 0, fillColor: ORANGE, fillOpacity: 0.16 }} />
            <Marker position={pickup} icon={orange} title="Approximate pickup area" />
          </>
        )}
        {dropoff && (
          <>
            <Circle center={dropoff} radius={AREA_RADIUS_M} options={{ strokeWeight: 0, fillColor: PURPLE, fillOpacity: 0.16 }} />
            <Marker position={dropoff} icon={purple} title="Approximate dropoff area" />
          </>
        )}
      </GoogleMap>
    </div>
  )
}
