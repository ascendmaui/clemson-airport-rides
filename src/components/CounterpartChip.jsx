import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { loadPublicProfile, toCounterpartView } from '../../packages/rides-native/partyProfile.js'

export function CounterpartChip({ profileId, noun = 'rider', onOpen }) {
  const [person, setPerson] = useState(null)

  useEffect(() => {
    if (!profileId || !supabase) return undefined
    let alive = true
    loadPublicProfile(supabase, profileId)
      .then((profile) => {
        if (!alive) return
        setPerson(profile ? toCounterpartView(profile, { viewerIsRider: noun === 'driver' }) : null)
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

  return (
    <button
      type="button"
      className="pressable"
      onClick={onOpen}
      style={{
        marginTop: 8,
        width: '100%',
        textAlign: 'left',
        padding: 12,
        borderRadius: 16,
        background: 'rgba(82,45,128,0.08)',
        border: '1px solid rgba(82,45,128,0.16)',
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, color: '#F56600' }}>
        {noun === 'driver' ? 'YOUR DRIVER' : 'YOUR RIDER'}
      </div>
      <div style={{ fontWeight: 800, color: '#522D80', marginTop: 4 }}>{title}</div>
      <div style={{ fontSize: 13, color: '#0B1220', fontWeight: 700 }}>{rating}</div>
      {person?.vehicle ? <div style={{ fontSize: 13, color: '#5C6570' }}>{person.vehicle}</div> : null}
      {person?.rideStyle ? <div style={{ fontSize: 13, color: '#5C6570' }}>Ride style · {person.rideStyle}</div> : null}
      {person?.bio ? <div style={{ fontSize: 13, color: '#5C6570', marginTop: 4 }}>{person.bio}</div> : null}
    </button>
  )
}
