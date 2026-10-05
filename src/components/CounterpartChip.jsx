import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { pickerVehicleLine } from '../../packages/rides-native/drivers.js'
import { loadMatchedDriverCard, loadPublicProfile, toCounterpartView } from '../../packages/rides-native/partyProfile.js'

export function CounterpartChip({ profileId, noun = 'rider', eta = null, onOpen, style }) {
  const [person, setPerson] = useState(null)

  useEffect(() => {
    if (!profileId || !supabase) return undefined
    let alive = true
    const load = noun === 'driver'
      ? loadMatchedDriverCard(supabase, profileId)
      : loadPublicProfile(supabase, profileId).then((profile) => (
        profile ? toCounterpartView(profile, { viewerIsRider: false }) : null
      ))
    load
      .then((next) => {
        if (alive) setPerson(next)
      })
      .catch(() => {
        if (alive) setPerson(null)
      })
    return () => {
      alive = false
    }
  }, [profileId, noun])

  const title = person?.name || (noun === 'driver' ? 'Driver' : 'Rider')
  const rating = person?.ratingLine || 'Profile'
  const carLine = person?.vehicleLine || pickerVehicleLine(person?.vehicle, person?.plate)
  const photo = person?.photoUrl || null

  return (
    <button
      type="button"
      className="pressable"
      onClick={onOpen}
      aria-label={[title, carLine, eta].filter(Boolean).join('. ')}
      style={{
        marginTop: 8,
        width: '100%',
        textAlign: 'left',
        padding: 12,
        borderRadius: 16,
        background: 'rgba(82,45,128,0.08)',
        border: '1px solid rgba(82,45,128,0.16)',
        ...style,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, color: '#F56600' }}>
        {noun === 'driver' ? 'YOUR DRIVER' : 'YOUR RIDER'}
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
        {photo ? (
          <img
            src={photo}
            alt=""
            style={{ width: 52, height: 52, borderRadius: 16, objectFit: 'cover', flexShrink: 0 }}
          />
        ) : (
          <div
            aria-hidden="true"
            style={{
              width: 52,
              height: 52,
              borderRadius: 16,
              background: '#522D80',
              color: '#fff',
              display: 'grid',
              placeItems: 'center',
              fontWeight: 800,
              flexShrink: 0,
            }}
          >
            {(person?.initial || title.slice(0, 1) || '?').toUpperCase()}
          </div>
        )}
        <div>
          <div style={{ fontWeight: 800, color: '#522D80' }}>{title}</div>
          <div style={{ fontSize: 13, color: '#0B1220', fontWeight: 700 }}>{rating}</div>
          {carLine ? <div style={{ fontSize: 13, color: '#5C6570' }}>{carLine}</div> : null}
          {eta ? <div style={{ fontSize: 13, color: '#F56600', fontWeight: 800, marginTop: 2 }}>{eta}</div> : null}
        </div>
      </div>
      {person?.rideStyle ? <div style={{ fontSize: 13, color: '#5C6570', marginTop: 8 }}>Ride style · {person.rideStyle}</div> : null}
      {person?.bio ? <div style={{ fontSize: 13, color: '#5C6570', marginTop: 4 }}>{person.bio}</div> : null}
    </button>
  )
}
