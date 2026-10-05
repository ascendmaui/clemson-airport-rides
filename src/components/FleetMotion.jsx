import { useEffect, useRef, useState } from 'react'
import { fleetCarSvg, initialsMarkerSvg } from '../../shared/fleetCarSvg.js'
import { resolveDriverPortrait } from '../../shared/driverPortrait.js'
import {
  demoCarsNearReal,
  isSimulatedDriverId,
  refuseSimulatedDriverTap,
  simulatedFleetAt,
  simulatedFleetPercent,
} from '../../packages/rides-native/simulatedDrivers.js'
import { supabase } from '../lib/supabase.js'

function svgIcon(svg, w, h, ax, ay) {
  const maps = typeof window !== 'undefined' ? window.google?.maps : null
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: maps ? new maps.Size(w, h) : undefined,
    anchor: maps ? new maps.Point(ax, ay) : undefined,
  }
}

function lerp(from, to, t) {
  return {
    lat: from.lat + (to.lat - from.lat) * t,
    lng: from.lng + (to.lng - from.lng) * t,
  }
}

export function useLiveMapDrivers(enabled) {
  const realRef = useRef([])
  const tracksRef = useRef(new Map())
  useEffect(() => {
    if (!enabled || !supabase) {
      realRef.current = []
      return undefined
    }
    let alive = true
    const pull = async () => {
      const { data, error } = await supabase
        .from('driver_status')
        .select('driver_id, lat, lng, heading, online')
        .eq('online', true)
      if (!alive || error) return
      const rows = (data || []).filter((row) => row?.driver_id && !isSimulatedDriverId(row.driver_id) && row.lat != null && row.lng != null)
      const ids = rows.map((row) => row.driver_id)
      let profiles = []
      if (ids.length) {
        const res = await supabase.from('profiles').select('id, full_name, avatar_url').in('id', ids)
        profiles = res.data || []
      }
      const byId = new Map(profiles.map((row) => [row.id, row]))
      const now = performance.now()
      realRef.current = rows.map((row) => {
        const profile = byId.get(row.driver_id) || {}
        const next = { lat: Number(row.lat), lng: Number(row.lng) }
        const prev = tracksRef.current.get(row.driver_id)
        const from = prev ? lerp(prev.from, prev.to, Math.min(1, (now - prev.started) / 1000)) : next
        tracksRef.current.set(row.driver_id, { from, to: next, started: now, heading: Number(row.heading) || 0 })
        return {
          id: row.driver_id,
          full_name: profile.full_name || 'Driver',
          avatar_url: profile.avatar_url || null,
          isDemo: false,
          body: 'suv',
          livery: 'tiger',
          label: '',
        }
      })
    }
    pull()
    const timer = setInterval(pull, 8000)
    const channel = supabase
      .channel('map-driver-status')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_status' }, () => { pull() })
      .subscribe()
    return () => {
      alive = false
      clearInterval(timer)
      supabase.removeChannel(channel)
    }
  }, [enabled])
  return { realRef, tracksRef }
}

export function GoogleFleetMotion({ map, enabled, onSelect }) {
  const { realRef, tracksRef } = useLiveMapDrivers(enabled)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  useEffect(() => {
    if (!enabled || !map || typeof window === 'undefined' || !window.google?.maps) return undefined
    const markers = new Map()
    const cars = new Map()
    let raf = 0
    const forget = (id) => {
      const pair = markers.get(id)
      if (!pair) return
      pair.car.setMap(null)
      pair.badge.setMap(null)
      markers.delete(id)
      cars.delete(id)
    }
    const ensure = (id, z) => {
      const existing = markers.get(id)
      if (existing) return existing
      const car = new window.google.maps.Marker({ map, zIndex: z, clickable: false })
      const badge = new window.google.maps.Marker({ map, zIndex: z + 1 })
      badge.addListener('click', () => {
        const current = cars.get(id)
        if (!current) return
        if (current.isDemo) refuseSimulatedDriverTap(current.id)
        onSelectRef.current?.(current)
      })
      const pair = { car, badge, heading: null, badgeKey: '' }
      markers.set(id, pair)
      return pair
    }
    const paint = (id, car, z) => {
      cars.set(id, car)
      const pair = ensure(id, z)
      pair.car.setPosition(car.position)
      pair.badge.setPosition(car.position)
      const snapped = Math.round((((car.heading || 0) % 360) + 360) % 360 / 15) * 15
      if (pair.heading !== snapped || pair.body !== car.body || pair.livery !== car.livery) {
        pair.heading = snapped
        pair.body = car.body
        pair.livery = car.livery
        pair.car.setIcon(svgIcon(fleetCarSvg({ heading: snapped, body: car.body, livery: car.livery }), 48, 48, 24, 24))
      }
      const portrait = resolveDriverPortrait(car)
      const badgeKey = portrait.kind === 'photo' ? portrait.url : `initials:${portrait.initials}:${portrait.color}`
      if (pair.badgeKey !== badgeKey) {
        pair.badgeKey = badgeKey
        if (portrait.kind === 'photo') {
          pair.badge.setIcon({
            url: portrait.url,
            scaledSize: new window.google.maps.Size(36, 36),
            anchor: new window.google.maps.Point(18, 54),
          })
        } else {
          pair.badge.setIcon(svgIcon(initialsMarkerSvg(portrait.initials, portrait.color), 36, 36, 18, 54))
        }
      }
    }
    const frame = () => {
      if (document.hidden) return
      const now = performance.now()
      const real = realRef.current.map((row) => {
        const track = tracksRef.current.get(row.id)
        const t = track ? Math.min(1, (now - track.started) / 1000) : 1
        const position = track ? lerp(track.from, track.to, t) : { lat: 0, lng: 0 }
        return { ...row, position, lat: position.lat, lng: position.lng, heading: track?.heading || 0 }
      }).filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lng))
      const demo = demoCarsNearReal(simulatedFleetAt(now), real).map((car) => ({
        ...car,
        position: { lat: car.lat, lng: car.lng },
      }))
      const seen = new Set()
      for (const car of demo) {
        seen.add(car.id)
        paint(car.id, car, 6)
      }
      for (const car of real) {
        seen.add(car.id)
        paint(car.id, car, 30)
      }
      for (const id of markers.keys()) {
        if (!seen.has(id)) forget(id)
      }
      raf = requestAnimationFrame(frame)
    }
    const onVisible = () => {
      if (!document.hidden) raf = requestAnimationFrame(frame)
    }
    document.addEventListener('visibilitychange', onVisible)
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVisible)
      for (const id of [...markers.keys()]) forget(id)
    }
  }, [map, enabled, realRef, tracksRef])
  return null
}

export function PreviewFleetMotion({ enabled, onSelect }) {
  const layerRef = useRef(null)
  const { realRef, tracksRef } = useLiveMapDrivers(enabled)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  useEffect(() => {
    if (!enabled) return undefined
    const root = layerRef.current
    if (!root) return undefined
    const nodes = new Map()
    let raf = 0
    const frame = () => {
      if (document.hidden) return
      const now = performance.now()
      const real = realRef.current.map((row) => {
        const track = tracksRef.current.get(row.id)
        const t = track ? Math.min(1, (now - track.started) / 1000) : 1
        const position = track ? lerp(track.from, track.to, t) : null
        return position ? { ...row, ...position, heading: track.heading } : null
      }).filter(Boolean)
      const demo = demoCarsNearReal(simulatedFleetAt(now), real)
      const cars = [...demo, ...real]
      const seen = new Set()
      for (const car of cars) {
        seen.add(car.id)
        let node = nodes.get(car.id)
        if (!node) {
          node = document.createElement('button')
          node.type = 'button'
          node.style.position = 'absolute'
          node.style.transform = 'translate(-50%, -70%)'
          node.style.zIndex = car.isDemo ? '2' : '4'
          node.style.border = '0'
          node.style.padding = '0'
          node.style.background = 'transparent'
          node.style.pointerEvents = 'auto'
          node.addEventListener('click', (event) => {
            event.preventDefault()
            event.stopPropagation()
            if (String(node.dataset.demo) === 'true') refuseSimulatedDriverTap(node.dataset.id)
            onSelectRef.current?.({
              id: node.dataset.id,
              isDemo: node.dataset.demo === 'true',
              firstName: node.dataset.name,
              full_name: node.dataset.name,
              label: node.dataset.label,
              photo: node.dataset.photo,
              photoSmall: node.dataset.small,
              avatar_url: node.dataset.avatar || null,
            })
          })
          root.appendChild(node)
          nodes.set(car.id, node)
        }
        const spot = simulatedFleetPercent(car.lat, car.lng)
        node.style.left = `${spot.left}%`
        node.style.top = `${spot.top}%`
        node.dataset.id = car.id
        node.dataset.demo = car.isDemo ? 'true' : 'false'
        node.dataset.name = car.firstName || car.full_name || 'Driver'
        node.dataset.label = car.label || ''
        node.dataset.photo = car.photo || ''
        node.dataset.small = car.photoSmall || ''
        node.dataset.avatar = car.avatar_url || ''
        node.setAttribute('aria-label', car.isDemo ? `${car.firstName}, ${car.label}` : (car.full_name || 'Driver'))
        const portrait = resolveDriverPortrait(car)
        const face = portrait.kind === 'photo'
          ? `<img alt="" src="${portrait.url}" width="36" height="36" style="width:36px;height:36px;border-radius:50%;object-fit:cover;border:2px solid #fff" />`
          : `<span style="display:grid;place-items:center;width:36px;height:36px;border-radius:50%;background:${portrait.color};color:#fff;font-weight:800;border:2px solid #fff">${portrait.initials}</span>`
        const markup = `${face}<div style="margin-top:2px">${fleetCarSvg({ heading: car.heading, body: car.body, livery: car.livery })}</div>`
        if (node.dataset.markup !== markup) {
          node.dataset.markup = markup
          node.innerHTML = markup
        }
      }
      for (const [id, node] of nodes) {
        if (seen.has(id)) continue
        node.remove()
        nodes.delete(id)
      }
      raf = requestAnimationFrame(frame)
    }
    const onVisible = () => {
      if (!document.hidden) raf = requestAnimationFrame(frame)
    }
    document.addEventListener('visibilitychange', onVisible)
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVisible)
      for (const node of nodes.values()) node.remove()
    }
  }, [enabled, realRef, tracksRef])
  if (!enabled) return null
  return <div ref={layerRef} data-simulated-fleet="motion" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
}

export function DriverProfileCard({ driver, onClose }) {
  if (!driver) return null
  const portrait = resolveDriverPortrait({
    ...driver,
    avatar_url: driver.avatar_url,
    isDemo: driver.isDemo,
    source: driver.isDemo ? 'demo' : undefined,
  })
  const photo = driver.isDemo ? (driver.photo || portrait.url) : portrait.url
  const name = driver.firstName || driver.full_name || 'Driver'
  return (
    <div
      role="dialog"
      aria-label={name}
      style={{
        position: 'absolute',
        left: 12,
        top: 12,
        zIndex: 5,
        display: 'flex',
        gap: 10,
        alignItems: 'center',
        padding: 8,
        borderRadius: 16,
        background: '#fff',
        boxShadow: '0 8px 24px rgba(11,18,32,0.18)',
        maxWidth: '80%',
      }}
    >
      {portrait.kind === 'photo' ? (
        <img alt="" src={photo} width="64" height="64" style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover' }} />
      ) : (
        <span style={{
          width: 64,
          height: 64,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          background: portrait.color,
          color: '#fff',
          fontWeight: 800,
        }}
        >
          {portrait.initials}
        </span>
      )}
      <div>
        <div style={{ fontWeight: 800, color: '#522D80' }}>{name}</div>
        <div style={{ fontSize: 12, color: '#5c4a3a' }}>{driver.label || 'Driver'}</div>
      </div>
      <button type="button" aria-label="Close driver preview" onClick={onClose} style={{ border: 0, background: 'transparent', fontWeight: 800, color: '#522D80' }}>
        ×
      </button>
    </div>
  )
}
