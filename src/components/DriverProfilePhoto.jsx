import { useEffect, useState } from 'react'
import { authedJson } from '../lib/apiClient'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { driverProfilePhotoMessage } from '../../shared/profilePhotoReview.js'

const MAX_BYTES = 8 * 1024 * 1024

/**
 * Profile photo upload on the web driver desk (#/driver).
 * The server compares the photo with the license and returns Approved
 * or the closer-look message.
 */
export function DriverProfilePhoto() {
  const { user } = useAuth()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user?.id || !supabase) return undefined
    let alive = true
    authedJson(supabase, '/api/driver?action=profile-photo')
      .then((data) => {
        const photo = data?.photo
        if (!alive || !photo?.reviewStatus) return
        setNote(photo.driverMessage || driverProfilePhotoMessage(photo.reviewStatus))
      })
      .catch(() => {})
    return () => { alive = false }
  }, [user?.id])

  async function onFile(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !user?.id || !supabase) return
    setBusy(true)
    setError('')
    setNote('')
    try {
      if (!file.type.startsWith('image/')) throw new Error('Choose a photo.')
      if (file.size < 12_000) throw new Error('That photo is too small. Choose a clearer picture of yourself.')
      if (file.size > MAX_BYTES) throw new Error('Each photo must be 8MB or smaller.')
      const ext = file.type.includes('png') ? 'png' : file.type.includes('webp') ? 'webp' : file.type.includes('heic') || file.type.includes('heif') ? 'heic' : 'jpg'
      const path = `${user.id}/profile_photo/${Date.now()}.${ext}`
      const uploaded = await supabase.storage.from('driver-documents').upload(path, file, {
        contentType: file.type || 'image/jpeg',
        upsert: false,
      })
      if (uploaded.error) throw new Error(uploaded.error.message)
      const review = await authedJson(supabase, '/api/driver?action=profile-photo', {
        method: 'POST',
        body: { storagePath: path },
      })
      setNote(review.driverMessage || driverProfilePhotoMessage(review.reviewStatus))
    } catch (err) {
      setError(err?.message || 'Could not save that photo')
    } finally {
      setBusy(false)
    }
  }

  if (!user?.id) return null

  return (
    <div style={{ margin: '12px 0', padding: 12, borderRadius: 14, background: 'rgba(82,45,128,0.06)' }}>
      <div style={{ fontWeight: 800, color: 'var(--purple)' }}>Profile photo</div>
      <p style={{ fontSize: 13, color: 'var(--ink-secondary)', margin: '4px 0 8px', lineHeight: 1.45 }}>
        Add a photo of yourself. We compare it with the license already on file.
      </p>
      <label className="pressable" style={{ display: 'inline-block', fontWeight: 800, color: '#F56600', cursor: 'pointer' }}>
        {busy ? 'Saving…' : 'Choose a photo'}
        <input type="file" accept="image/*" hidden disabled={busy} onChange={onFile} aria-label="Upload profile photo" />
      </label>
      {error ? <p role="alert" style={{ color: 'var(--danger)', fontSize: 13, margin: '8px 0 0' }}>{error}</p> : null}
      {note ? <p role="status" style={{ fontWeight: 700, color: 'var(--purple)', fontSize: 14, margin: '8px 0 0' }}>{note}</p> : null}
    </div>
  )
}
