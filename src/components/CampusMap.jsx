import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GoogleMap, useJsApiLoader, Marker, Circle, Polyline } from '@react-google-maps/api'
import { downtownNow, heatColor } from '../lib/downtownHeat'

export const CLEMSON = [34.6784, -82.8397]
export const STADIUM = [34.6788, -82.8430]

const ORANGE = '#F56600'
const PURPLE = '#522D80'

const MAP_LIBRARIES = []

const CLEMSON_MAP_STYLES = [
  { elementType: 'geometry', stylers: [{ color: '#f5f2ef' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#5c4a3a' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#f5f2ef' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#ebe3d9' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#dce8d4' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#f0e6dc' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#f2c9a0' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: ORANGE }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#c9d6e8' }] },
]

function toLatLng(pair, fallback = CLEMSON) {
  if (!pair || pair.length < 2) return { lat: fallback[0], lng: fallback[1] }
  return { lat: Number(pair[0]), lng: Number(pair[1]) }
}

function pinSvg(color, size = 18) {
  const s = size
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
        <circle cx="${s / 2}" cy="${s / 2}" r="${s / 2 - 2}" fill="${color}" stroke="#fff" stroke-width="3"/>
      </svg>`,
    )}`,
    scaledSize: typeof window !== 'undefined' && window.google?.maps
      ? new window.google.maps.Size(s, s)
      : undefined,
    anchor: typeof window !== 'undefined' && window.google?.maps
      ? new window.google.maps.Point(s / 2, s / 2)
      : undefined,
  }
}

function useAnimatedPosition(target, enabled) {
  const [pos, setPos] = useState(target)
  const current = useRef(target)
  const raf = useRef(0)

  useEffect(() => {
    if (!target) return undefined
    if (!enabled || !current.current) {
      current.current = target
      setPos(target)
      return undefined
    }
    const from = current.current
    const to = target
    const start = performance.now()
    const dur = 800
    cancelAnimationFrame(raf.current)
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur)
      const ease = 1 - (1 - t) ** 3
      const next = {
        lat: from.lat + (to.lat - from.lat) * ease,
        lng: from.lng + (to.lng - from.lng) * ease,
      }
      current.current = next
      setPos(next)
      if (t < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [target?.lat, target?.lng, enabled])

  return pos
}

function FallbackMap({ wrapStyle, message }) {
  return (
    <div
      style={{
        ...wrapStyle,
        display: 'grid',
        placeItems: 'center',
        background: 'linear-gradient(135deg, rgba(245,102,0,0.12), rgba(82,45,128,0.18))',
        color: 'var(--ink-secondary)',
        padding: 16,
        textAlign: 'center',
        fontSize: 13,
      }}
    >
      {message}
    </div>
  )
}

export function CampusMap({
  height = 160,
  interactive = false,
  center = CLEMSON,
  zoom = 14,
  showHeat = false,
  route = null,
  dragPin = false,
  onPinMove,
  marker = STADIUM,
  driverPosition = null,
  pickupPosition = null,
  selfPosition = null,
  animateDriver = false,
}) {
  const apiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim()
  const { isLoaded, loadError } = useJsApiLoader({
    id: 'clemson-google-maps',
    googleMapsApiKey: apiKey || ' ',
    libraries: MAP_LIBRARIES,
  })

  const wrapStyle =
    typeof height === 'number'
      ? { height, borderRadius: 16, overflow: 'hidden', position: 'relative' }
      : {
          height: height || '100%',
          width: '100%',
          borderRadius: 0,
          overflow: 'hidden',
          position: 'absolute',
          inset: 0,
        }

  const mapCenter = useMemo(() => toLatLng(center), [center?.[0], center?.[1]])
  const primary = useMemo(() => toLatLng(marker, center), [marker?.[0], marker?.[1], center?.[0], center?.[1]])
  const driverTarget = useMemo(
    () => (driverPosition ? toLatLng(driverPosition) : null),
    [driverPosition?.[0], driverPosition?.[1]],
  )
  const animatedDriver = useAnimatedPosition(driverTarget, Boolean(animateDriver && driverTarget))
  const pickup = useMemo(
    () => (pickupPosition ? toLatLng(pickupPosition) : null),
    [pickupPosition?.[0], pickupPosition?.[1]],
  )
  const self = useMemo(
    () => (selfPosition ? toLatLng(selfPosition) : null),
    [selfPosition?.[0], selfPosition?.[1]],
  )
  const heat = showHeat ? downtownNow() : null
  const path = useMemo(() => {
    if (!route?.length) return null
    return route.map((p) => toLatLng(p))
  }, [route])

  const mapRef = useRef(null)
  const onLoad = useCallback((map) => {
    mapRef.current = map
  }, [])

  useEffect(() => {
    if (!mapRef.current || !driverTarget || !animateDriver) return
    mapRef.current.panTo(driverTarget)
  }, [driverTarget?.lat, driverTarget?.lng, animateDriver])

  if (!apiKey) {
    return (
      <FallbackMap
        wrapStyle={wrapStyle}
        message="Map preview needs VITE_GOOGLE_MAPS_API_KEY (Maps JavaScript API)."
      />
    )
  }
  if (loadError) {
    return <FallbackMap wrapStyle={wrapStyle} message="Google Maps failed to load. Check the API key / referrer." />
  }
  if (!isLoaded) {
    return <FallbackMap wrapStyle={wrapStyle} message="Loading map…" />
  }

  const orangeIcon = pinSvg(ORANGE, 18)
  const purpleIcon = pinSvg(PURPLE, 16)
  const driverIcon = pinSvg(ORANGE, 20)

  return (
    <div style={wrapStyle}>
      <GoogleMap
        mapContainerStyle={{ height: '100%', width: '100%' }}
        center={animatedDriver && animateDriver ? animatedDriver : mapCenter}
        zoom={zoom}
        onLoad={onLoad}
        options={{
          disableDefaultUI: !interactive,
          zoomControl: interactive,
          gestureHandling: interactive || dragPin ? 'greedy' : 'none',
          styles: CLEMSON_MAP_STYLES,
          clickableIcons: false,
          fullscreenControl: false,
          mapTypeControl: false,
          streetViewControl: false,
        }}
        onDragEnd={() => {
          if (!dragPin || !mapRef.current || !onPinMove) return
          const c = mapRef.current.getCenter()
          if (c) onPinMove([c.lat(), c.lng()])
        }}
      >
        {heat?.spots?.map((s) => (
          <Circle
            key={s.id}
            center={{ lat: s.lat, lng: s.lng }}
            radius={s.radius}
            options={{
              strokeWeight: 0,
              fillColor: heatColor(s.intensity),
              fillOpacity: 0.12 + s.intensity * 0.32,
            }}
          />
        ))}
        {path && (
          <Polyline path={path} options={{ strokeColor: PURPLE, strokeWeight: 4, strokeOpacity: 0.85 }} />
        )}
        {!driverTarget && !pickup && !self && (
          <Marker position={primary} icon={showHeat ? purpleIcon : orangeIcon} />
        )}
        {pickup && <Marker position={pickup} icon={purpleIcon} title="Pickup" />}
        {self && <Marker position={self} icon={purpleIcon} title="You" />}
        {(animatedDriver || driverTarget) && (
          <Marker position={animatedDriver || driverTarget} icon={driverIcon} title="Driver" />
        )}
      </GoogleMap>
    </div>
  )
}
