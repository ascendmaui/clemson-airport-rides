import { useEffect, useMemo, useRef, useState } from 'react'
import { catalogKindLabel, placeFromStop, searchCatalogPlaces } from '../lib/placeCatalog'
import { LOCATION_MISSING_MESSAGE, placeFromCoordinates, readBrowserPosition, reverseGeocodeLabel } from '../lib/currentPlace'
import { mergeSuggestions, useAddressSuggestions } from '../lib/useAddressSuggestions'
import { AddressAttribution } from './AddressAttribution'
import { SiteIcon } from './SiteIcon'

/**
 * Typed pickup or drop-off. Catalog matches show first as the rider types.
 * After 3+ characters, street suggestions come from Geoapify (or Photon when
 * no key is set) under the catalog rows. If both fail, catalog rows only.
 */
export function AddressSuggest({ label, value, onChange, placeholder }) {
  const [query, setQuery] = useState(value?.label || '')
  const [open, setOpen] = useState(false)
  const [locating, setLocating] = useState(false)
  const [locateError, setLocateError] = useState(null)
  const locateLabel = /drop/i.test(label || '')
    ? 'Use current location as drop-off'
    : 'Use current location as pickup'
  const inputRef = useRef(null)
  const catalogRows = useMemo(() => (open ? searchCatalogPlaces(query).slice(0, 6) : []), [open, query])
  const typed = query.trim() !== (value?.label || '').trim()
  const remote = useAddressSuggestions(query, { enabled: open && typed })
  const remoteRows = open && typed ? remote.results : []
  const suggestions = useMemo(() => mergeSuggestions(catalogRows, remoteRows), [catalogRows, remoteRows])
  const showsRemote = suggestions.some((row) => row.kind === 'address')

  useEffect(() => {
    if (!inputRef.current || document.activeElement === inputRef.current) return
    inputRef.current.value = value?.label || ''
    setQuery(value?.label || '')
  }, [value?.label])

  async function useCurrent() {
    setLocateError(null)
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocateError(LOCATION_MISSING_MESSAGE)
      return
    }
    setLocating(true)
    try {
      const fix = await readBrowserPosition()
      const placeLabel = await reverseGeocodeLabel(fix.lat, fix.lng)
      const place = placeFromCoordinates(fix.lat, fix.lng, placeLabel)
      if (!place) {
        setLocateError('Could not read your location.')
        return
      }
      onChange?.(place)
      setQuery(place.label)
      setOpen(false)
      if (inputRef.current) inputRef.current.value = place.label
    } catch (err) {
      setLocateError(err?.message || 'Could not get current location. Check permissions.')
    } finally {
      setLocating(false)
    }
  }

  function choose(stop) {
    const place = placeFromStop(stop)
    if (!place) return
    onChange?.(place)
    setQuery(place.label)
    setOpen(false)
    if (inputRef.current) inputRef.current.value = place.label
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>
        {label}
        <span style={{ position: 'relative', display: 'block', marginTop: 6 }}>
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
              padding: '12px 48px 12px 14px',
              borderRadius: 12,
            }}
          />
          <button
            type="button"
            className="pressable"
            aria-label={locateLabel}
            disabled={locating}
            onClick={useCurrent}
            style={{
              position: 'absolute',
              right: 6,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 36,
              height: 36,
              borderRadius: 18,
              border: '1px solid var(--orange)',
              background: 'rgba(245,102,0,0.12)',
              color: 'var(--orange)',
              fontWeight: 800,
              fontSize: 18,
            }}
          >
            <SiteIcon name="locate" size={18} />
          </button>
        </span>
      </label>
      {locateError ? <p style={{ color: 'var(--danger, #b00020)', fontSize: 12, marginTop: 6 }}>{locateError}</p> : null}
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
              <span style={{ fontWeight: 600, color: 'var(--ink-tertiary)', marginLeft: 8 }}>
                {stop.kind === 'address' ? 'Address' : catalogKindLabel(stop.kind)}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {open && showsRemote ? <AddressAttribution provider={remote.provider} /> : null}
    </div>
  )
}
