import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GoogleMap, useJsApiLoader, Marker, Circle, Polygon, Polyline, OverlayView } from '@react-google-maps/api'
import { downtownNow, heatColor } from '../lib/downtownHeat'
import { MAPS_LOADER_ID, MAP_LIBRARIES, mapsLoaderOptions } from '../lib/googleMapsLoader'
import { googleMapStyle } from '../../packages/rides-native/googleMapChrome.js'
import { lerpHeading } from '../../packages/rides-native/roadFollow.js'
import { fetchRideDemand, loadMapType, saveMapType } from '../lib/rideDemand'
import { MapTypeSelect } from './MapTypeSelect'
import { SIMULATED_FLEET_BADGE, busyCarSvg } from '../../packages/rides-native/simulatedDrivers.js'
import { fetchTigerHeatMap } from '../../packages/rides-native/tigerHeatClient.js'
import { DriverProfileCard, GoogleFleetMotion, PreviewFleetMotion } from './FleetMotion.jsx'

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

function busyCarIcon(heading) {
  const w = 48
  const h = 56
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(busyCarSvg(heading))}`,
    scaledSize: typeof window !== 'undefined' && window.google?.maps
      ? new window.google.maps.Size(w, h)
      : undefined,
    anchor: typeof window !== 'undefined' && window.google?.maps
      ? new window.google.maps.Point(24, 18)
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

function useColorSchemeDark() {
  const [dark, setDark] = useState(() => (
    typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  ))
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => setDark(media.matches)
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [])
  return dark
}

function AnimatedDriverMarker({ target, heading, enabled }) {
  const [pose, setPose] = useState(() => (
    target
      ? { lat: target.lat, lng: target.lng, heading: Number.isFinite(Number(heading)) ? Number(heading) : null }
      : null
  ))
  const current = useRef(pose)
  const raf = useRef(0)

  useEffect(() => {
    if (!target) return undefined
    const from = current.current
    const toHeading = Number.isFinite(Number(heading)) ? Number(heading) : from?.heading ?? null
    if (!enabled || !from) {
      const next = { lat: target.lat, lng: target.lng, heading: toHeading }
      current.current = next
      setPose(next)
      return undefined
    }
    const start = performance.now()
    const dur = 900
    const fromHeading = from.heading
    cancelAnimationFrame(raf.current)
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur)
      const ease = 1 - (1 - t) ** 3
      const next = {
        lat: from.lat + (target.lat - from.lat) * ease,
        lng: from.lng + (target.lng - from.lng) * ease,
        heading: lerpHeading(fromHeading, toHeading, ease),
      }
      current.current = next
      setPose(next)
      if (t < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [target?.lat, target?.lng, heading, enabled])

  const at = target ? (pose || target) : null
  if (!at || !target) return null
  const driverHeading = at.heading
  const driverIcon = Number.isFinite(Number(driverHeading)) ? busyCarIcon(Number(driverHeading)) : pinSvg(ORANGE, 20)
  return <Marker position={{ lat: at.lat, lng: at.lng }} icon={driverIcon} title="Driver" />
}

function FleetBadge() {
  return (
    <div
      role="note"
      data-simulated-fleet="busy"
      style={{
        position: 'absolute',
        right: 12,
        bottom: 12,
        zIndex: 3,
        pointerEvents: 'none',
        padding: '6px 10px',
        borderRadius: 999,
        background: '#522D80',
        color: '#fff',
        fontWeight: 800,
        fontSize: 12,
      }}
    >
      {SIMULATED_FLEET_BADGE}
    </div>
  )
}

function previewRoutePoints(route) {
  const spots = (route || [])
    .map((spot) => toLatLng(spot))
    .filter((spot) => Number.isFinite(spot.lat) && Number.isFinite(spot.lng))
  if (spots.length < 2) return []
  const lats = spots.map((spot) => spot.lat)
  const lngs = spots.map((spot) => spot.lng)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)
  const latSpan = maxLat - minLat || 0.01
  const lngSpan = maxLng - minLng || 0.01
  return spots.map((spot) => ({
    x: 14 + ((spot.lng - minLng) / lngSpan) * 72,
    y: 86 - ((spot.lat - minLat) / latSpan) * 72,
  }))
}

function FallbackRoute({ route }) {
  const points = previewRoutePoints(route)
  if (points.length < 2) return null
  const d = points.map((spot, index) => `${index === 0 ? 'M' : 'L'} ${spot.x.toFixed(1)} ${spot.y.toFixed(1)}`).join(' ')
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    >
      <path d={d} fill="none" stroke="#F56600" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" opacity="0.35" />
      <path d={d} fill="none" stroke="#522D80" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function TigerHeatChip({ zone }) {
  const preview = zone.preview || !zone.payable
  return (
    <div
      data-tiger-heat={preview ? 'preview' : 'live'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        margin: 4,
        padding: '6px 10px',
        borderRadius: 999,
        background: preview ? '#522D80' : '#F56600',
        color: '#fff',
        border: '2px solid #522D80',
        fontWeight: 800,
        fontSize: 12,
      }}
    >
      {zone.bonusLabel || 'Tiger Heat'}
    </div>
  )
}

function FallbackMap({ wrapStyle, message, badge, route = null, tigerZones = [] }) {
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
      <FallbackRoute route={route} />
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
      {tigerZones.length ? (
        <div style={{ position: 'absolute', left: 12, top: 12, right: 12, display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-start' }}>
          {tigerZones.map((zone) => <TigerHeatChip key={zone.id} zone={zone} />)}
        </div>
      ) : null}
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
  driverHeading = null,
  pickupPosition = null,
  dropoffPosition = null,
  selfPosition = null,
  animateDriver = false,
  gameDayLabel = null,
  stops = null,
  showSimulatedFleet = false,
  fitRoute = false,
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
          zIndex: 0,
        }

  const mapCenter = useMemo(() => toLatLng(center), [center?.[0], center?.[1]])
  const primary = useMemo(() => toLatLng(marker, center), [marker?.[0], marker?.[1], center?.[0], center?.[1]])
  const driverTarget = useMemo(
    () => (driverPosition ? toLatLng(driverPosition) : null),
    [driverPosition?.[0], driverPosition?.[1]],
  )
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
  const preferDark = useColorSchemeDark()
  const [demand, setDemand] = useState(null)
  const [tigerZones, setTigerZones] = useState([])

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

  useEffect(() => {
    if (!showHeat) {
      setTigerZones([])
      return undefined
    }
    let cancelled = false
    fetchTigerHeatMap(heatWindow).then((result) => {
      if (!cancelled) setTigerZones(result.zones || [])
    }).catch(() => {
      if (!cancelled) setTigerZones([])
    })
    return () => {
      cancelled = true
    }
  }, [showHeat, heatWindow])

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
  const [mapReady, setMapReady] = useState(null)
  const [previewDriver, setPreviewDriver] = useState(null)
  const fittedKey = useRef('')
  const stopRef = useRef(stopMarkers)
  const driverRef = useRef(driverTarget)
  const pickupRef = useRef(pickup)
  const dropoffRef = useRef(dropoff)
  const pathRef = useRef(path)
  const fitRouteRef = useRef(fitRoute)
  stopRef.current = stopMarkers
  driverRef.current = driverTarget
  pickupRef.current = pickup
  dropoffRef.current = dropoff
  pathRef.current = path
  fitRouteRef.current = fitRoute
  const fitStopBounds = useCallback((map) => {
    const list = stopRef.current
    const fitting = fitRouteRef.current
    const routePoints = fitting && Array.isArray(pathRef.current) ? pathRef.current : []
    const pickupPoint = fitting ? pickupRef.current : null
    const dropoffPoint = fitting ? dropoffRef.current : null
    if (!map || typeof window === 'undefined' || !window.google?.maps) return
    if (!list.length && routePoints.length < 2 && !pickupPoint && !dropoffPoint) return
    const driver = driverRef.current
    const end = routePoints.length ? routePoints[routePoints.length - 1] : null
    const routeKey = end
      ? `${Math.round(routePoints.length / 15)}:${end.lat.toFixed(3)},${end.lng.toFixed(3)}`
      : 'noroute'
    const driverKey = driver ? `${driver.lat.toFixed(2)},${driver.lng.toFixed(2)}` : 'x'
    const placeKey = [
      pickupPoint ? `${pickupPoint.lat.toFixed(4)},${pickupPoint.lng.toFixed(4)}` : '',
      dropoffPoint ? `${dropoffPoint.lat.toFixed(4)},${dropoffPoint.lng.toFixed(4)}` : '',
    ].join(';')
    const key = `${driverKey}|${list.map((stop) => `${stop.lat.toFixed(5)},${stop.lng.toFixed(5)}`).join(';')}|${placeKey}|${routeKey}`
    if (fittedKey.current === key) return
    const bounds = new window.google.maps.LatLngBounds()
    for (const stop of list) bounds.extend({ lat: stop.lat, lng: stop.lng })
    for (const spot of routePoints) bounds.extend({ lat: spot.lat, lng: spot.lng })
    if (pickupPoint) bounds.extend(pickupPoint)
    if (dropoffPoint) bounds.extend(dropoffPoint)
    if (driver) bounds.extend(driver)
    map.fitBounds(bounds, routePoints.length > 1 || pickupPoint ? 48 : 40)
    fittedKey.current = key
  }, [])
  const onLoad = useCallback((map) => {
    mapRef.current = map
    setMapReady(map)
    fitStopBounds(map)
  }, [fitStopBounds])

  useEffect(() => {
    fitStopBounds(mapRef.current)
  }, [fitStopBounds, stopMarkers, driverTarget, pickup, dropoff, isLoaded, path, fitRoute])

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
      <div style={{ position: 'relative' }}>
        <FallbackMap
          wrapStyle={wrapStyle}
          badge={gameDayLabel}
          route={route}
          tigerZones={showHeat ? tigerZones : []}
          message="Map preview needs VITE_GOOGLE_MAPS_API_KEY (Maps JavaScript API)."
        />
        <PreviewFleetMotion enabled={showSimulatedFleet} onSelect={setPreviewDriver} />
        <DriverProfileCard driver={previewDriver} onClose={() => setPreviewDriver(null)} />
        {showSimulatedFleet ? <FleetBadge /> : null}
      </div>
    )
  }
  if (loadError) {
    return (
      <div style={{ position: 'relative' }}>
        <FallbackMap wrapStyle={wrapStyle} badge={gameDayLabel} route={route} tigerZones={showHeat ? tigerZones : []} message="Google Maps failed to load. Check the API key / referrer." />
        <PreviewFleetMotion enabled={showSimulatedFleet} onSelect={setPreviewDriver} />
        <DriverProfileCard driver={previewDriver} onClose={() => setPreviewDriver(null)} />
        {showSimulatedFleet ? <FleetBadge /> : null}
      </div>
    )
  }
  if (!isLoaded) {
    return (
      <div style={{ position: 'relative' }}>
        <FallbackMap wrapStyle={wrapStyle} badge={gameDayLabel} route={route} tigerZones={showHeat ? tigerZones : []} message="Loading map…" />
        <PreviewFleetMotion enabled={showSimulatedFleet} onSelect={setPreviewDriver} />
        <DriverProfileCard driver={previewDriver} onClose={() => setPreviewDriver(null)} />
        {showSimulatedFleet ? <FleetBadge /> : null}
      </div>
    )
  }

  const orangeIcon = pinSvg(ORANGE, 18)
  const purpleIcon = pinSvg(PURPLE, 16)
  const surgeHot = heatMode === 'surge'
  const mapStyles = useClemsonStyles ? (preferDark ? googleMapStyle('dark') : CLEMSON_MAP_STYLES) : null

  return (
    <div style={wrapStyle} data-heat-fallback="circles" data-maps-loader={MAPS_LOADER_ID} data-map-type-control={showMapTypeControl ? 'dropdown' : undefined}>
      <GoogleMap
        mapContainerStyle={{ height: '100%', width: '100%' }}
        center={mapCenter}
        zoom={zoom}
        onLoad={onLoad}
        mapTypeId={resolvedMapType}
        options={{
          disableDefaultUI: true,
          zoomControl: interactive,
          gestureHandling: interactive || dragPin ? 'greedy' : 'none',
          styles: mapStyles,
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
        {tigerZones.map((zone) => (
          <Polygon
            key={`tiger-${zone.id}`}
            paths={(zone.polygon || []).map((point) => ({ lat: point.lat, lng: point.lng }))}
            options={{
              strokeColor: zone.strokeColor || PURPLE,
              strokeOpacity: 0.95,
              strokeWeight: 2,
              fillColor: zone.fillColor || ORANGE,
              fillOpacity: zone.preview ? 0.16 : 0.34,
            }}
          />
        ))}
        {tigerZones.map((zone) => (
          <Polygon
            key={`tiger-inner-${zone.id}`}
            paths={(zone.innerPolygon || []).map((point) => ({ lat: point.lat, lng: point.lng }))}
            options={{
              strokeColor: ORANGE,
              strokeOpacity: 0.7,
              strokeWeight: 1,
              fillColor: PURPLE,
              fillOpacity: zone.preview ? 0.08 : 0.18,
            }}
          />
        ))}
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
          <Polyline path={secondaryPath} options={{ strokeColor: ORANGE, strokeWeight: 9, strokeOpacity: 0.35 }} />
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
        <AnimatedDriverMarker target={driverTarget} heading={driverHeading} enabled={Boolean(animateDriver && driverTarget)} />
        {tigerZones.map((zone) => (
          <OverlayView
            key={`tiger-label-${zone.id}`}
            position={{ lat: zone.lat, lng: zone.lng }}
            mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
          >
            <div
              data-tiger-heat={zone.preview ? 'preview' : 'live'}
              style={{
                transform: 'translate(-50%, -50%)',
                padding: '6px 10px',
                borderRadius: 999,
                background: zone.preview ? '#522D80' : '#F56600',
                color: '#fff',
                border: '2px solid #522D80',
                fontWeight: 800,
                fontSize: 12,
                whiteSpace: 'nowrap',
                boxShadow: '0 2px 8px rgba(82,45,128,0.25)',
              }}
            >
              {zone.bonusLabel}
            </div>
          </OverlayView>
        ))}
      </GoogleMap>
      <GoogleFleetMotion map={mapReady} enabled={showSimulatedFleet} onSelect={setPreviewDriver} />
      <DriverProfileCard driver={previewDriver} onClose={() => setPreviewDriver(null)} />
      {showSimulatedFleet ? <FleetBadge /> : null}
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
            top: 10,
            right: 10,
            zIndex: 2,
          }}
        >
          <MapTypeSelect value={resolvedMapType} onChange={setMapType} />
        </div>
      ) : null}
    </div>
  )
}
