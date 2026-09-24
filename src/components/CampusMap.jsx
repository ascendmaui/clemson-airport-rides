import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GoogleMap, useJsApiLoader, Marker, Circle, Polyline } from '@react-google-maps/api'
import { downtownNow, heatColor } from '../lib/downtownHeat'
import { MAPS_LOADER_ID, MAP_LIBRARIES, mapsLoaderOptions } from '../lib/googleMapsLoader'
import { fetchRideDemand, MAP_TYPES, loadMapType, saveMapType } from '../lib/rideDemand'

export const CLEMSON = [34.6784, -82.8397]
export const STADIUM = [34.6788, -82.8430]

const ORANGE = '#F56600'
const PURPLE = '#522D80'

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

function numberedPinSvg(color, badge) {
  const label = String(badge ?? '')
  const w = label.length > 1 ? 28 : 22
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${w}" viewBox="0 0 ${w} ${w}">
        <circle cx="${w / 2}" cy="${w / 2}" r="${w / 2 - 2}" fill="${color}" stroke="#fff" stroke-width="2"/>
        <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" fill="#fff" font-family="Arial,sans-serif" font-size="12" font-weight="700">${label}</text>
      </svg>`,
    )}`,
    scaledSize: typeof window !== 'undefined' && window.google?.maps
      ? new window.google.maps.Size(w, w)
      : undefined,
    anchor: typeof window !== 'undefined' && window.google?.maps
      ? new window.google.maps.Point(w / 2, w / 2)
      : undefined,
  }
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

function FallbackMap({ wrapStyle, message, badge }) {
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
      {badge ? (
        <div style={{
          position: 'absolute',
          left: 12,
          bottom: 12,
          maxWidth: '80%',
          padding: '6px 10px',
          borderRadius: 999,
          background: '#F56600',
          color: '#fff',
          fontWeight: 800,
          fontSize: 12,
        }}
        >
          {badge}
        </div>
      ) : null}
      {/* TODO: a live stadium ring on this preview needs Maps JavaScript billing (VITE_GOOGLE_MAPS_API_KEY). The zone and fare multiplier stay on the badge. */}
      <div>{message}</div>
    </div>
  )
}

/** Render demand as Circles — avoids deprecated google.maps.visualization.HeatmapLayer crash. */
function demandToSpots(points, heatMode) {
  if (!points?.length) return []
  const maxW = Math.max(...points.map((p) => Number(p.weight) || Number(p.count) || 1), 1)
  return points.map((p, i) => {
    const w = Number(p.weight) || Number(p.count) || 1
    const intensity = Math.min(1, w / maxW)
    const baseR = heatMode === 'surge' ? 90 : 70
    return {
      id: p.id || `d-${i}`,
      lat: Number(p.lat),
      lng: Number(p.lng),
      intensity: heatMode === 'surge' ? Math.min(1, intensity * 1.15) : intensity,
      radius: baseR + intensity * (heatMode === 'surge' ? 80 : 60),
    }
  }).filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
}

export function CampusMap({
  height = 160,
  interactive = false,
  center = CLEMSON,
  zoom = 14,
  showHeat = false,
  heatMode = 'busy',
  heatWindow = 'now',
  onHeatMeta,
  mapTypeId: mapTypeIdProp,
  showMapTypeControl = false,
  onMapTypeChange,
  route = null,
  routeSecondary = null,
  areaCircles = null,
  dragPin = false,
  onPinMove,
  marker = STADIUM,
  driverPosition = null,
  pickupPosition = null,
  dropoffPosition = null,
  selfPosition = null,
  animateDriver = false,
  gameDayLabel = null,
  stops = null,
}) {
  const apiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim()
  const { isLoaded, loadError } = useJsApiLoader(mapsLoaderOptions(apiKey))

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
  const [internalMapType, setInternalMapType] = useState(() => loadMapType())
  const controlled = mapTypeIdProp === 'roadmap' || mapTypeIdProp === 'satellite' || mapTypeIdProp === 'hybrid'
  const activeMapType = controlled ? mapTypeIdProp : internalMapType
  const resolvedMapType = activeMapType === 'satellite' || activeMapType === 'hybrid' ? activeMapType : 'roadmap'
  const useClemsonStyles = resolvedMapType === 'roadmap'
  const [demand, setDemand] = useState(null)

  const setMapType = useCallback((id) => {
    const next = id === 'satellite' || id === 'hybrid' ? id : 'roadmap'
    if (!controlled) {
      setInternalMapType(next)
      saveMapType(next)
    }
    onMapTypeChange?.(next)
  }, [controlled, onMapTypeChange])

  useEffect(() => {
    if (!showHeat) {
      setDemand(null)
      onHeatMeta?.(null)
      return undefined
    }
    let cancelled = false
    ;(async () => {
      try {
        const result = await fetchRideDemand({ mode: heatMode, windowId: heatWindow })
        if (cancelled) return
        setDemand(result)
        onHeatMeta?.(result)
      } catch (e) {
        if (cancelled) return
        setDemand({ points: [], blended: true, label: 'Live + typical', error: e?.message })
        onHeatMeta?.({ blended: true, label: 'Live + typical', error: e?.message })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [showHeat, heatMode, heatWindow])

  const heatSpots = useMemo(() => {
    if (!showHeat) return []
    const fromDemand = demandToSpots(demand?.points, heatMode)
    if (fromDemand.length) return fromDemand
    return downtownNow()?.spots || []
  }, [showHeat, demand, heatMode])

  const path = useMemo(() => {
    if (!route?.length) return null
    return route.map((p) => toLatLng(p))
  }, [route])
  const secondaryPath = useMemo(() => {
    if (!routeSecondary?.length) return null
    return routeSecondary.map((p) => toLatLng(p))
  }, [routeSecondary])
  const dropoff = useMemo(
    () => (dropoffPosition ? toLatLng(dropoffPosition) : null),
    [dropoffPosition?.[0], dropoffPosition?.[1]],
  )
  const stopMarkers = useMemo(() => {
    if (!Array.isArray(stops)) return []
    return stops
      .map((stop, index) => ({
        id: stop.id || `stop-${index}`,
        lat: Number(stop.lat),
        lng: Number(stop.lng),
        label: stop.label || stop.title || `Stop ${index + 1}`,
        color: stop.color || (index === stops.length - 1 ? ORANGE : PURPLE),
        badge: stop.badge != null ? String(stop.badge) : String(index + 1),
      }))
      .filter((stop) => Number.isFinite(stop.lat) && Number.isFinite(stop.lng))
  }, [stops])
  const areas = useMemo(() => {
    if (!areaCircles?.length) return []
    return areaCircles
      .map((c, i) => ({
        id: c.id || `area-${i}`,
        lat: Number(c.lat),
        lng: Number(c.lng),
        radius: Number(c.radius) || 450,
        color: c.color || PURPLE,
      }))
      .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng))
  }, [areaCircles])

  const mapRef = useRef(null)
  const fittedKey = useRef('')
  const stopRef = useRef(stopMarkers)
  const driverRef = useRef(driverTarget)
  stopRef.current = stopMarkers
  driverRef.current = driverTarget
  const fitStopBounds = useCallback((map) => {
    const list = stopRef.current
    if (!map || !list.length || typeof window === 'undefined' || !window.google?.maps) return
    const driver = driverRef.current
    const key = `${driver ? 'd' : 'x'}|${list.map((stop) => `${stop.lat.toFixed(5)},${stop.lng.toFixed(5)}`).join(';')}`
    if (fittedKey.current === key) return
    const bounds = new window.google.maps.LatLngBounds()
    for (const stop of list) bounds.extend({ lat: stop.lat, lng: stop.lng })
    if (driver) bounds.extend(driver)
    map.fitBounds(bounds, 40)
    fittedKey.current = key
  }, [])
  const onLoad = useCallback((map) => {
    mapRef.current = map
    fitStopBounds(map)
  }, [fitStopBounds])

  useEffect(() => {
    fitStopBounds(mapRef.current)
  }, [fitStopBounds, stopMarkers, driverTarget, isLoaded])

  useEffect(() => {
    if (!mapRef.current || !driverTarget || !animateDriver) return
    mapRef.current.panTo(driverTarget)
  }, [driverTarget?.lat, driverTarget?.lng, animateDriver])
  useEffect(() => {
    if (!mapRef.current || !isLoaded) return
    try {
      mapRef.current.setMapTypeId(resolvedMapType)
    } catch {
      /* ignore */
    }
  }, [resolvedMapType, isLoaded])

  if (!apiKey) {
    return (
      <FallbackMap
        wrapStyle={wrapStyle}
        badge={gameDayLabel}
        message="Map preview needs VITE_GOOGLE_MAPS_API_KEY (Maps JavaScript API)."
      />
    )
  }
  if (loadError) {
    return <FallbackMap wrapStyle={wrapStyle} badge={gameDayLabel} message="Google Maps failed to load. Check the API key / referrer." />
  }
  if (!isLoaded) {
    return <FallbackMap wrapStyle={wrapStyle} badge={gameDayLabel} message="Loading map…" />
  }

  const orangeIcon = pinSvg(ORANGE, 18)
  const purpleIcon = pinSvg(PURPLE, 16)
  const driverIcon = pinSvg(ORANGE, 20)
  const surgeHot = heatMode === 'surge'

  return (
    <div style={wrapStyle} data-heat-fallback="circles" data-maps-loader={MAPS_LOADER_ID} data-map-type-control={showMapTypeControl ? 'dropdown' : undefined}>
      <GoogleMap
        mapContainerStyle={{ height: '100%', width: '100%' }}
        center={animatedDriver && animateDriver ? animatedDriver : mapCenter}
        zoom={zoom}
        onLoad={onLoad}
        mapTypeId={resolvedMapType}
        options={{
          disableDefaultUI: true,
          zoomControl: interactive,
          gestureHandling: interactive || dragPin ? 'greedy' : 'none',
          styles: useClemsonStyles ? CLEMSON_MAP_STYLES : null,
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
        {gameDayLabel ? (
          <Circle
            center={{ lat: STADIUM[0], lng: STADIUM[1] }}
            radius={420}
            options={{
              strokeColor: ORANGE,
              strokeOpacity: 0.95,
              strokeWeight: 2,
              fillColor: ORANGE,
              fillOpacity: 0.22,
            }}
          />
        ) : null}
        {heatSpots.map((s) => (
          <Circle
            key={s.id}
            center={{ lat: s.lat, lng: s.lng }}
            radius={s.radius}
            options={{
              strokeWeight: 0,
              fillColor: heatColor(s.intensity),
              fillOpacity: (surgeHot ? 0.18 : 0.12) + s.intensity * (surgeHot ? 0.4 : 0.32),
            }}
          />
        ))}
        {areas.map((c) => (
          <Circle
            key={c.id}
            center={{ lat: c.lat, lng: c.lng }}
            radius={c.radius}
            options={{
              strokeColor: c.color,
              strokeOpacity: 0.8,
              strokeWeight: 1,
              fillColor: c.color,
              fillOpacity: 0.18,
            }}
          />
        ))}
        {secondaryPath && (
          <Polyline path={secondaryPath} options={{ strokeColor: ORANGE, strokeWeight: 4, strokeOpacity: 0.8 }} />
        )}
        {path && (
          <Polyline path={path} options={{ strokeColor: PURPLE, strokeWeight: 5, strokeOpacity: 0.9 }} />
        )}
        {!areas.length && !stopMarkers.length && !driverTarget && !pickup && !self && (
          <Marker position={primary} icon={showHeat ? purpleIcon : orangeIcon} />
        )}
        {!areas.length && !stopMarkers.length && pickup && <Marker position={pickup} icon={purpleIcon} title="Pickup" />}
        {!areas.length && !stopMarkers.length && dropoff && <Marker position={dropoff} icon={orangeIcon} title="Dropoff" />}
        {stopMarkers.map((stop) => (
          <Marker
            key={stop.id}
            position={{ lat: stop.lat, lng: stop.lng }}
            icon={numberedPinSvg(stop.color, stop.badge)}
            title={stop.label}
          />
        ))}
        {self && <Marker position={self} icon={purpleIcon} title="You" />}
        {(animatedDriver || driverTarget) && (
          <Marker position={animatedDriver || driverTarget} icon={driverIcon} title="Driver" />
        )}
      </GoogleMap>
      {gameDayLabel ? (
        <div style={{
          position: 'absolute',
          left: 12,
          bottom: 12,
          zIndex: 2,
          maxWidth: '70%',
          padding: '6px 10px',
          borderRadius: 999,
          background: '#F56600',
          color: '#fff',
          fontWeight: 800,
          fontSize: 12,
        }}
        >
          {gameDayLabel}
        </div>
      ) : null}
      {showMapTypeControl ? (
        <div
          data-map-type-control="dropdown"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 1000,
            pointerEvents: 'none',
          }}
        >
          <label
            style={{
              position: 'absolute',
              top: 10,
              right: 10,
              display: 'inline-flex',
              alignItems: 'center',
              margin: 0,
              pointerEvents: 'auto',
            }}
          >
            <span className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
              Map type
            </span>
            <select
              aria-label="Map type"
              value={resolvedMapType}
              onChange={(e) => setMapType(e.target.value)}
              style={{
                appearance: 'none',
                WebkitAppearance: 'none',
                MozAppearance: 'none',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: 0.2,
                padding: '7px 30px 7px 10px',
                borderRadius: 12,
                border: '1px solid rgba(82,45,128,0.35)',
                background:
                  '#fff url("data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 12 12%27%3E%3Cpath fill=%27%23522D80%27 d=%27M3 4.5L6 8l3-3.5%27/%3E%3C/svg%3E") no-repeat right 10px center',
                color: '#522D80',
                boxShadow: '0 2px 10px rgba(11,18,32,0.22)',
                cursor: 'pointer',
                minWidth: 108,
                maxWidth: 148,
              }}
            >
              {MAP_TYPES.map((mt) => (
                <option key={mt.id} value={mt.id}>
                  {mt.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
    </div>
  )
}
