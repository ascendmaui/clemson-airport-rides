import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  MAX_VEHICLE_PHOTOS,
  VEHICLE_PHOTO_KINDS,
  isVehiclePhotoKind,
  listProfileVehiclePhotos,
  listVehiclePhotos,
  removeVehiclePhoto,
  uploadVehiclePhoto,
} from '../../packages/rides-native/vehiclePhotos.js'

export function VehiclePhotoGrid({ photos, onRemove, busy, emptyLabel = 'No vehicle photos yet.' }) {
  if (!photos?.length) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-secondary)' }}>
        {emptyLabel}
      </p>
    )
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      {photos.map((photo) => (
        <figure key={`${photo.source || 'photo'}-${photo.id}`} style={{ margin: 0, borderRadius: 12, overflow: 'hidden', background: 'rgba(82,45,128,0.05)' }}>
          <figcaption style={{ fontSize: 11, fontWeight: 700, padding: '6px 8px', color: 'var(--purple)' }}>
            {photo.label}
          </figcaption>
          {photo.url ? (
            <a href={photo.url} target="_blank" rel="noreferrer">
              <img src={photo.url} alt={`${photo.label} vehicle photo`} style={{ width: '100%', height: 96, objectFit: 'cover', display: 'block' }} />
            </a>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--ink-tertiary)', padding: 8 }}>Preview unavailable</div>
          )}
          {onRemove && photo.source !== 'angle' ? (
            <button
              type="button"
              className="pressable"
              disabled={busy}
              onClick={() => onRemove(photo)}
              style={{
                display: 'block',
                width: '100%',
                minHeight: 44,
                padding: '12px 8px',
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--danger)',
                background: 'transparent',
                textAlign: 'left',
              }}
            >
              Remove
            </button>
          ) : null}
        </figure>
      ))}
    </div>
  )
}

export function VehiclePhotoGallery({
  userId,
  includeAngles = false,
  readOnly = false,
  hideWhenEmpty = false,
}) {
  const [photos, setPhotos] = useState([])
  const [kind, setKind] = useState('exterior')
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(null)

  async function refresh() {
    if (!supabase || !userId) {
      setPhotos([])
      setReady(true)
      return
    }
    const next = includeAngles
      ? await listProfileVehiclePhotos(supabase, userId)
      : await listVehiclePhotos(supabase, userId)
    setPhotos(next)
    setReady(true)
  }

  useEffect(() => {
    let alive = true
    setReady(false)
    refresh()
      .catch((err) => {
        if (alive) setError(err.message || 'Could not load vehicle photos')
      })
      .finally(() => {
        if (alive) setReady(true)
      })
    return () => {
      alive = false
    }
  }, [userId, includeAngles])

  async function onFiles(fileList) {
    if (!supabase || !userId) {
      setError('Sign in to add vehicle photos.')
      return
    }
    const files = Array.from(fileList || [])
    if (!files.length) return
    if (!isVehiclePhotoKind(kind)) {
      setError('Choose exterior, interior, or other.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      for (const file of files) {
        await uploadVehiclePhoto(supabase, userId, kind, file)
      }
      await refresh()
    } catch (err) {
      setError(err.message || 'Could not save that photo')
      await refresh().catch(() => {})
    } finally {
      setBusy(false)
    }
  }

  async function onRemove(photo) {
    if (!supabase || !userId) return
    setBusy(true)
    setError(null)
    try {
      await removeVehiclePhoto(supabase, userId, photo)
      await refresh()
    } catch (err) {
      setError(err.message || 'Could not remove that photo')
    } finally {
      setBusy(false)
    }
  }

  const extras = photos.filter((photo) => photo.source !== 'angle')
  const atCap = extras.length >= MAX_VEHICLE_PHOTOS
  if (hideWhenEmpty && ready && !error && photos.length === 0) return null
  if (!ready && hideWhenEmpty) return null

  return (
    <section aria-label="Vehicle photos" style={{ marginTop: 14 }}>
      <h3 style={{ margin: '0 0 6px', fontSize: 15, color: 'var(--purple)' }}>Vehicle photos</h3>
      <p style={{ margin: '0 0 10px', fontSize: 13, lineHeight: 1.45, color: 'var(--ink-secondary)' }}>
        {readOnly
          ? 'Exterior, interior, and other photos saved on this driver profile.'
          : 'Add more than one photo of the exterior, interior, or another view. They show on your driver profile and on the web applicant review before an admin approves you.'}
      </p>
      {error ? <p role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p> : null}
      {!ready ? <p style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>Loading vehicle photos…</p> : null}
      {ready ? (
        <VehiclePhotoGrid photos={photos} onRemove={readOnly ? null : onRemove} busy={busy} />
      ) : null}
      {!readOnly ? (
        <div style={{ marginTop: 12 }}>
          <div role="radiogroup" aria-label="Vehicle photo type" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {VEHICLE_PHOTO_KINDS.map((item) => {
              const selected = kind === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className="pressable"
                  onClick={() => setKind(item.id)}
                  style={{
                    minHeight: 44,
                    padding: '12px 14px',
                    borderRadius: 999,
                    fontWeight: 700,
                    fontSize: 12,
                    color: selected ? '#fff' : 'var(--purple)',
                    background: selected ? 'var(--orange)' : 'white',
                    border: '1px solid rgba(82,45,128,0.15)',
                  }}
                >
                  {item.label}
                </button>
              )
            })}
          </div>
          <p style={{ margin: '8px 0', fontSize: 12, color: 'var(--ink-tertiary)' }}>
            {VEHICLE_PHOTO_KINDS.find((item) => item.id === kind)?.hint}. Up to {MAX_VEHICLE_PHOTOS} extra photos. 8MB each.
          </p>
          <label
            style={{
              display: 'block',
              padding: 12,
              borderRadius: 14,
              fontWeight: 700,
              textAlign: 'center',
              color: atCap ? 'var(--ink-tertiary)' : 'var(--purple)',
              border: '1.5px dashed rgba(82,45,128,0.35)',
              background: 'rgba(255,255,255,0.55)',
              cursor: atCap || busy ? 'default' : 'pointer',
            }}
          >
            {busy ? 'Saving photos…' : atCap ? 'Photo limit reached' : `Add ${kind} photos`}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              multiple
              disabled={busy || atCap || !userId}
              hidden
              onChange={(event) => {
                const files = event.target.files
                event.target.value = ''
                onFiles(files)
              }}
            />
          </label>
        </div>
      ) : null}
    </section>
  )
}
