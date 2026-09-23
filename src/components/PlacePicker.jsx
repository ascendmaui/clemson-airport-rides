import { useEffect, useRef, useState } from 'react'
import { useJsApiLoader } from '@react-google-maps/api'
import { FRIEND_PLACES } from '../lib/friendRides'

/** Separate loader from CampusMap circles-v2 — do not add places to CampusMap. */
const PLACES_LIBRARIES = ['places']
const PLACES_LOADER_ID = 'clemson-google-maps-places-v1'

const CURRENT = { label: 'Current location', lat: null, lng: null, _current: true }

const chipStyle = (on) => ({
  padding: '7px 12px',
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 700,
  border: on ? 'none' : '1px solid var(--border)',
  background: on ? 'rgba(82,45,128,0.92)' : 'rgba(255,255,255,0.7)',
  color: on ? '#fff' : 'var(--purple)',
  cursor: 'pointer',
})

function reverseGeocodeLabel(lat, lng) {
  return new Promise((resolve) => {
    try {
      if (!window.google?.maps?.Geocoder) {
        resolve(`Current location (${lat.toFixed(4)}, ${lng.toFixed(4)})`)
        return
      }
      const geocoder = new window.google.maps.Geocoder()
      geocoder.geocode({ location: { lat, lng } }, (results, status) => {
        if (status === 'OK' && results?.[0]?.formatted_address) {
          resolve(results[0].formatted_address)
        } else {
          resolve(`Current location (${lat.toFixed(4)}, ${lng.toFixed(4)})`)
        }
      })
    } catch {
      resolve(`Current location (${lat.toFixed(4)}, ${lng.toFixed(4)})`)
    }
  })
}

/**
 * Pickup: Current location + campus preset chips.
 * Dropoff: Places Autocomplete free-form + preset chips.
 * value shape: { label, lat, lng }
 */
export function PlacePicker({
  label,
  value,
  onChange,
  mode = 'pickup',
  presets = FRIEND_PLACES,
}) {
  const apiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim()
  const { isLoaded } = useJsApiLoader({
    id: PLACES_LOADER_ID,
    googleMapsApiKey: apiKey || ' ',
    libraries: PLACES_LIBRARIES,
  })
  const [locBusy, setLocBusy] = useState(false)
  const [locError, setLocError] = useState(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const inputRef = useRef(null)
  const acRef = useRef(null)

  useEffect(() => {
    if (mode !== 'dropoff' || !isLoaded || !apiKey || !inputRef.current) return undefined
    if (!window.google?.maps?.places?.Autocomplete) return undefined
    if (acRef.current) return undefined
    const ac = new window.google.maps.places.Autocomplete(inputRef.current, {
      fields: ['formatted_address', 'geometry', 'name'],
      componentRestrictions: { country: 'us' },
    })
    acRef.current = ac
    const listener = ac.addListener('place_changed', () => {
      const place = ac.getPlace()
      const loc = place?.geometry?.location
      if (!loc) return
      const lat = loc.lat()
      const lng = loc.lng()
      const placeLabel = place.formatted_address || place.name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`
      onChange?.({ label: placeLabel, lat, lng })
    })
    return () => {
      if (listener) listener.remove()
      acRef.current = null
    }
  }, [mode, isLoaded, apiKey, onChange])

  async function useCurrentLocation() {
    setLocError(null)
    if (!navigator.geolocation) {
      setLocError('Location is not available on this device.')
      setConfirmOpen(false)
      return
    }
    setLocBusy(true)
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 10000,
        })
      })
      const lat = pos.coords.latitude
      const lng = pos.coords.longitude
      const placeLabel = await reverseGeocodeLabel(lat, lng)
      onChange?.({ label: placeLabel, lat, lng })
    } catch (e) {
      setLocError(e?.message || 'Could not get current location. Check permissions.')
    } finally {
      setLocBusy(false)
      setConfirmOpen(false)
    }
  }

  const selectedLabel = value?.label || ''
  const isPickup = mode === 'pickup'

  return (
    <div style={{ marginBottom: 12 }} data-places-loader={PLACES_LOADER_ID}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-secondary)', marginBottom: 4 }}>{label}</div>

      {isPickup ? (
        <select
          value={value?._current || selectedLabel === 'Current location' ? '__current__' : selectedLabel}
          onChange={(e) => {
            const v = e.target.value
            if (v === '__current__') {
              setConfirmOpen(true)
              return
            }
            const preset = presets.find((x) => x.label === v)
            onChange?.(preset || null)
          }}
          style={{ width: '100%', padding: 12, borderRadius: 12, border: '1px solid var(--border)', background: '#fff' }}
        >
          <option value="">Select place…</option>
          <option value="__current__">{CURRENT.label}</option>
          {presets.map((p) => (
            <option key={p.label} value={p.label}>{p.label}</option>
          ))}
        </select>
      ) : (
        <input
          ref={inputRef}
          defaultValue={selectedLabel}
          placeholder={apiKey ? 'Search any address…' : 'Address search needs Maps API key'}
          style={{ width: '100%', padding: 12, borderRadius: 12, border: '1px solid var(--border)', background: '#fff' }}
        />
      )}

      {selectedLabel ? (
        <div style={{ fontSize: 12, color: 'var(--ink-tertiary)', marginTop: 6 }}>
          Selected: <strong style={{ color: 'var(--ink-secondary)' }}>{selectedLabel}</strong>
          {value?.lat != null && value?.lng != null ? ` · ${Number(value.lat).toFixed(4)}, ${Number(value.lng).toFixed(4)}` : ''}
        </div>
      ) : null}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
        {isPickup && (
          <button type="button" className="pressable" onClick={() => setConfirmOpen(true)} style={chipStyle(false)}>
            📍 Current location
          </button>
        )}
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            className="pressable"
            onClick={() => onChange?.(p)}
            style={chipStyle(selectedLabel === p.label)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {locError && <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 6 }}>{locError}</p>}

      {confirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed', inset: 0, zIndex: 80,
            background: 'rgba(11,18,32,0.45)',
            display: 'grid', placeItems: 'center', padding: 24,
          }}
          onClick={() => !locBusy && setConfirmOpen(false)}
        >
          <div
            className="glass-panel"
            style={{ maxWidth: 340, width: '100%', padding: 18, borderRadius: 18, background: '#fff' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 800, color: 'var(--purple)', marginBottom: 8 }}>Allow location?</div>
            <p style={{ fontSize: 13, color: 'var(--ink-secondary)', lineHeight: 1.45, marginBottom: 14 }}>
              Use your current location as the pickup pin. Your browser will ask for permission.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="pressable"
                disabled={locBusy}
                onClick={() => setConfirmOpen(false)}
                style={{ flex: 1, padding: 12, borderRadius: 12, fontWeight: 600, background: 'rgba(0,0,0,0.06)' }}
              >
                Not now
              </button>
              <button
                type="button"
                className="pressable"
                disabled={locBusy}
                onClick={useCurrentLocation}
                style={{
                  flex: 1, padding: 12, borderRadius: 12, fontWeight: 700, color: '#fff',
                  background: 'linear-gradient(135deg, var(--orange), #ff7a1a)',
                }}
              >
                {locBusy ? 'Locating…' : 'Allow'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export { PLACES_LOADER_ID, PLACES_LIBRARIES }
