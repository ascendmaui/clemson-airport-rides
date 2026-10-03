import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { navigate } from '../lib/navigation'
import { supabase } from '../lib/supabase'
import { loadDriverDesk, subscribeTrips } from '../../packages/rides-native/driverDesk.js'
import { showOfferInTopBar } from '../../packages/rides-native/driverShift.js'
import { isSyntheticOffer } from '../../packages/rides-native/syntheticOffers.js'

/**
 * Stays mounted above route changes. Reading driver_status here does not
 * clear online when the driver leaves the driver screen or switches tabs.
 */
export function DriverOnlineChrome({ path }) {
  const { user } = useAuth()
  const [online, setOnline] = useState(false)
  const [offer, setOffer] = useState(null)
  const userId = user?.id

  useEffect(() => {
    if (!supabase || !userId) {
      setOnline(false)
      setOffer(null)
      return undefined
    }
    let alive = true
    const pull = async () => {
      const { data } = await supabase
        .from('driver_status')
        .select('online')
        .eq('driver_id', userId)
        .maybeSingle()
      if (!alive) return
      const nextOnline = Boolean(data?.online)
      setOnline(nextOnline)
      if (!nextOnline) {
        setOffer(null)
        return
      }
      try {
        const desk = await loadDriverDesk(supabase, userId)
        if (!alive) return
        const next = (desk.offers || []).find((card) => !isSyntheticOffer(card)) || null
        setOffer(next)
      } catch {
        if (alive) setOffer(null)
      }
    }
    pull()
    const onVisible = () => {
      if (document.visibilityState === 'visible') pull()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('hashchange', pull)
    const channel = supabase
      .channel(`web-driver-presence-${userId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'driver_status',
        filter: `driver_id=eq.${userId}`,
      }, () => { pull() })
      .subscribe()
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('hashchange', pull)
      supabase.removeChannel(channel)
    }
  }, [userId])

  useEffect(() => {
    if (!supabase || !userId || !online) return undefined
    return subscribeTrips(supabase, () => {
      loadDriverDesk(supabase, userId).then((desk) => {
        const next = (desk.offers || []).find((card) => !isSyntheticOffer(card)) || null
        setOffer(next)
      }).catch(() => {})
    })
  }, [online, userId])

  if (!online) return null
  const showOffer = showOfferInTopBar({
    online,
    hasOffer: Boolean(offer),
    onDriverHome: path === 'driver',
    appActive: typeof document === 'undefined' ? true : document.visibilityState === 'visible',
  })
  return (
    <div style={{ position: 'absolute', top: 8, left: 12, right: 12, zIndex: 60, display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none' }}>
      <div style={{ pointerEvents: 'auto', background: '#522D80', color: '#fff', borderRadius: 14, textAlign: 'center', fontWeight: 800, fontSize: 14, padding: '8px 14px' }}>
        Clemson Rides, you are online.
      </div>
      {showOffer && offer ? (
        <button
          type="button"
          className="pressable"
          onClick={() => navigate('driver')}
          style={{ pointerEvents: 'auto', background: '#F56600', color: '#fff', border: 0, borderRadius: 14, textAlign: 'left', fontWeight: 700, padding: '10px 14px' }}
        >
          <div style={{ fontSize: 12, fontWeight: 800 }}>New ride offer</div>
          <div>{offer.pickupLabel} → {offer.dropoffLabel}</div>
        </button>
      ) : null}
    </div>
  )
}
