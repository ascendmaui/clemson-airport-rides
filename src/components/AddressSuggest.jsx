import { useEffect, useMemo, useRef, useState } from 'react'
import { useJsApiLoader } from '@react-google-maps/api'
import { placeFromStop, searchCatalogPlaces } from '../lib/placeCatalog'
import { MAPS_LOADER_ID, MAP_LIBRARIES, mapsLoaderOptions } from '../lib/googleMapsLoader'

/**
 * Typed pickup or drop-off. Catalog matches show as the rider types.
 * A billed Maps key also attaches Google address suggestions on the same field.
 */
export function AddressSuggest({ label, value, onChange, placeholder }) {
  const apiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim()
  const { isLoaded } = useJsApiLoader(mapsLoaderOptions(apiKey))
  const [query, setQuery] = useState(value?.label || '')
  const [open, setOpen] = useState(false)
  const inputRef = useRef(null)
  const acRef = useRef(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const suggestions = useMemo(() => (open ? searchCatalogPlaces(query).slice(0, 6) : []), [open, query])

  useEffect(() => {
    if (!inputRef.current || document.activeElement === inputRef.current) return
    inputRef.current.value = value?.label || ''
    setQuery(value?.label || '')
  }, [value?.label])

  useEffect(() => {
    if (!isLoaded || !apiKey || !inputRef.current || acRef.current) return undefined
    if (!window.google?.maps?.places?.Autocomplete) return undefined
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
      onChangeRef.current?.({ label: placeLabel, lat, lng })
      setQuery(placeLabel)
      setOpen(false)
      if (inputRef.current) inputRef.current.value = placeLabel
    })
    return () => {
      if (listener) listener.remove()
      acRef.current = null
    }
  }, [isLoaded, apiKey])

  function choose(stop) {
    const place = placeFromStop(stop)
    if (!place) return
    onChange?.(place)
    setQuery(place.label)
    setOpen(false)
    if (inputRef.current) inputRef.current.value = place.label
  }

  return (
    <div style={{ marginBottom: 12 }} data-places-loader={MAPS_LOADER_ID} data-places-libraries={MAP_LIBRARIES.join(',')}>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>
        {label}
        <input
          ref={inputRef}
          className="glass-input"
          aria-label={label}
          defaultValue={value?.label || ''}
          placeholder={placeholder || 'Type a campus stop, airport, or address'}
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onInput={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          style={{
            width: '100%',
            marginTop: 6,
            padding: '12px 14px',
            borderRadius: 12,
          }}
        />
      </label>
      {open && suggestions.length > 0 ? (
        <div role="listbox" aria-label={`${label} suggestions`} style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
          {suggestions.map((stop) => (
            <button
              key={stop.id}
              type="button"
              role="option"
              className="pressable"
              onClick={() => choose(stop)}
              style={{
                textAlign: 'left',
                padding: '10px 12px',
                borderRadius: 12,
                border: '1px solid rgba(82,45,128,0.25)',
                background: value?.label === stop.label ? 'rgba(82,45,128,0.12)' : '#fff',
                color: 'var(--purple)',
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              {stop.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
