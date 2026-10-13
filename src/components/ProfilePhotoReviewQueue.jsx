import { useEffect, useState } from 'react'
import { fetchProfilePhotoQueue, reviewProfilePhoto } from '../lib/driverOnboarding'

/**
 * Admins approve or reject driver profile photos here:
 * https://clemsonrides.com/#/admin?tab=applications
 * (Admin → Applicants, the Driver review screen).
 */
export function ProfilePhotoReviewQueue() {
  const [photos, setPhotos] = useState([])
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [busyId, setBusyId] = useState('')
  const [reasons, setReasons] = useState({})

  async function load() {
    const data = await fetchProfilePhotoQueue()
    setPhotos(data.photos || [])
    if (data.migrationRequired) {
      setError('Apply supabase/migrations/20261013180000_driver_profile_photo_ai_review.sql')
    }
  }

  useEffect(() => {
    load().catch((err) => setError(err.message || 'Could not load profile photos'))
  }, [])

  async function decide(photoId, decision) {
    setBusyId(photoId)
    setError('')
    setNote('')
    try {
      const result = await reviewProfilePhoto({
        photoId,
        decision,
        reason: reasons[photoId] || '',
      })
      setNote(result.message || (decision === 'approve' ? 'Profile photo approved.' : 'Profile photo rejected.'))
      await load()
    } catch (err) {
      setError(err.message || 'Could not save that decision')
    } finally {
      setBusyId('')
    }
  }

  return (
    <section aria-label="Profile photo review" style={{ marginTop: 16 }}>
      <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--purple)', margin: '0 0 6px' }}>Profile photos</h2>
      <p style={{ color: 'var(--ink-secondary)', fontSize: 13, lineHeight: 1.45, marginTop: 0 }}>
        A clear photo of one face that matches the license is already approved. Photos still marked pending manual review are listed here too. Rejection stays with an admin.
      </p>
      {error ? <p role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p> : null}
      {note ? <p style={{ color: 'var(--purple)', fontWeight: 700, fontSize: 13 }}>{note}</p> : null}
      {photos.length === 0 ? (
        <div className="sheet" style={{ padding: 16, borderRadius: 18, color: 'var(--ink-secondary)' }}>
          No profile photos are waiting for review.
        </div>
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {photos.map((photo) => {
          const confidence = photo.aiConfidence == null ? null : `${Math.round(Number(photo.aiConfidence) * 100)}%`
          return (
            <div key={photo.id} className="sheet" style={{ padding: 14, borderRadius: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ fontWeight: 800, color: 'var(--purple)' }}>{photo.name}</div>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--orange)' }}>{photo.reviewStatus}</div>
              </div>
              <div style={{ fontSize: 13, marginTop: 6, color: 'var(--ink)' }}>
                <span style={{ fontWeight: 800 }}>Reason: </span>
                {photo.aiReason || 'Waiting for admin review.'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-secondary)', marginTop: 4 }}>
                {[photo.aiVerdict, confidence ? `confidence ${confidence}` : null, photo.licenseMatchStatus ? `license ${photo.licenseMatchStatus}` : null].filter(Boolean).join(' · ')}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                {photo.url ? (
                  <a href={photo.url} target="_blank" rel="noreferrer">
                    <img src={photo.url} alt={`Profile photo for ${photo.name}`} style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 12 }} />
                  </a>
                ) : null}
                {photo.licenseUrl ? (
                  <a href={photo.licenseUrl} target="_blank" rel="noreferrer">
                    <img src={photo.licenseUrl} alt={`License for ${photo.name}`} style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 12 }} />
                  </a>
                ) : null}
              </div>
              <label style={{ display: 'block', marginTop: 10, fontSize: 13, fontWeight: 650 }}>
                Rejection reason
                <textarea
                  value={reasons[photo.id] || ''}
                  onChange={(event) => setReasons((prev) => ({ ...prev, [photo.id]: event.target.value }))}
                  rows={2}
                  style={{ display: 'block', width: '100%', marginTop: 6, borderRadius: 12, border: '1px solid var(--border)', padding: 10 }}
                />
              </label>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button
                  type="button"
                  className="pressable"
                  disabled={busyId === photo.id}
                  onClick={() => decide(photo.id, 'approve')}
                  style={{ padding: '10px 14px', borderRadius: 14, fontWeight: 800, color: '#fff', background: '#522D80' }}
                >
                  Approve photo
                </button>
                <button
                  type="button"
                  className="pressable"
                  disabled={busyId === photo.id}
                  onClick={() => decide(photo.id, 'reject')}
                  style={{ padding: '10px 14px', borderRadius: 14, fontWeight: 800, color: 'var(--danger)', background: '#fff', border: '1.5px solid rgba(217,45,32,0.35)' }}
                >
                  Reject photo
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
