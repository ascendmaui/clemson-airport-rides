import { MapContainer, TileLayer, Marker, Circle, Polyline, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { useEffect } from 'react'

const CLEMSON = [34.6784, -82.8397]
const STADIUM = [34.6788, -82.8430]

const pinIcon = new L.DivIcon({
  className: '',
  html: `<div style="width:18px;height:18px;border-radius:50%;background:#F56600;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.25)"></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

const purplePin = new L.DivIcon({
  className: '',
  html: `<div style="width:16px;height:16px;border-radius:50%;background:#522D80;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.25)"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
})

function DragHandler({ onDrag }) {
  useMapEvents({
    move() {
      /* visual only */
    },
    dragend(e) {
      const c = e.target.getCenter()
      onDrag?.([c.lat, c.lng])
    },
  })
  return null
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
}) {
  useEffect(() => {
    // fix default icon path issues in bundlers
  }, [])

  const wrapStyle = typeof height === 'number'
    ? { height, borderRadius: 16, overflow: 'hidden', position: 'relative' }
    : { height: height || '100%', width: '100%', borderRadius: 0, overflow: 'hidden', position: 'absolute', inset: 0 }

  return (
    <div style={wrapStyle}>
      <MapContainer
        center={center}
        zoom={zoom}
        style={{ height: '100%', width: '100%' }}
        zoomControl={interactive}
        dragging={interactive || dragPin}
        scrollWheelZoom={interactive}
        attributionControl={false}
      >
        <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
        {showHeat && (
          <>
            <Circle center={[34.6795, -82.837]} radius={350} pathOptions={{ color: '#522D80', fillColor: '#522D80', fillOpacity: 0.22, weight: 0 }} />
            <Circle center={[34.676, -82.845]} radius={280} pathOptions={{ color: '#F56600', fillColor: '#F56600', fillOpacity: 0.16, weight: 0 }} />
          </>
        )}
        {route && <Polyline positions={route} pathOptions={{ color: '#522D80', weight: 4, opacity: 0.85 }} />}
        <Marker position={marker || center} icon={showHeat ? purplePin : pinIcon} />
        {dragPin && <DragHandler onDrag={onPinMove} />}
      </MapContainer>
    </div>
  )
}

export { CLEMSON, STADIUM }
