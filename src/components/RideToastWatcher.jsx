/**
 * Watches trip / friend_ride / ride_bills changes and emits toasts.
 * Supabase realtime when available; poll fallback on active screens.
 */
import { useEffect, useRef } from 'react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { pushToast } from '../lib/toasts'
import { fetchNotificationPrefs } from '../lib/notificationPrefs'
import { useToasts } from '../lib/toasts'

const TRIP_STATUS_KIND = {
  searching: 'ride_requested',
  offered: 'ride_requested',
  accepted: 'driver_accepted',
  arriving: 'driver_en_route',
  arrived: 'arrived_pickup',
  in_progress: 'trip_started',
  completed: 'trip_completed',
  canceled: 'system',
  cancelled_wait: 'system',
  canceled_midride: 'canceled_midride',
}

function tripBody(row) {
  const from = row?.pickup_label || 'Pickup'
  const to = row?.dropoff_label || 'Dropoff'
  return `${from} → ${to}`
}

export function RideToastWatcher() {
  const { user } = useAuth()
  const { setPrefsCache } = useToasts()
  const seenTrip = useRef(new Map()) // id -> status
  const seenPay = useRef(new Map()) // id -> midride payment status
  const seenFriend = useRef(new Map()) // id -> status|participantCount
  const seenBill = useRef(new Map()) // id -> status
  const primed = useRef(false)

  // Load prefs into toast cache
  useEffect(() => {
    if (!user?.id) return undefined
    let alive = true
    fetchNotificationPrefs(user.id).then(({ prefs }) => {
      if (alive) setPrefsCache(prefs)
    })
    return () => { alive = false }
  }, [user?.id, setPrefsCache])

  useEffect(() => {
    if (!supabase || !user?.id) return undefined
    let alive = true
    primed.current = false

    async function hydrate() {
      const [{ data: trips }, { data: rides }, { data: bills }] = await Promise.all([
        supabase
          .from('trips')
          .select('id, status, pickup_label, dropoff_label, rider_id, driver_id, metadata, updated_at')
          .or(`rider_id.eq.${user.id},driver_id.eq.${user.id}`)
          .order('requested_at', { ascending: false })
          .limit(12),
        supabase
          .from('friend_rides')
          .select('id, status, kind, organizer_id, created_at')
          .eq('organizer_id', user.id)
          .order('created_at', { ascending: false })
          .limit(8),
        supabase
          .from('ride_bills')
          .select('id, status, amount_cents, created_at')
          .eq('participant_profile_id', user.id)
          .order('created_at', { ascending: false })
          .limit(8),
      ])
      if (!alive) return
      ;(trips || []).forEach((t) => {
        seenTrip.current.set(t.id, t.status)
        seenPay.current.set(t.id, t.metadata?.midride_cancel?.paymentStatus || null)
      })
      ;(rides || []).forEach((r) => seenFriend.current.set(r.id, r.status))
      ;(bills || []).forEach((b) => seenBill.current.set(b.id, b.status))
      primed.current = true
    }

    function onTripRow(row) {
      if (!row?.id) return
      const pay = row.metadata?.midride_cancel?.paymentStatus || null
      if (!primed.current) {
        seenTrip.current.set(row.id, row.status)
        seenPay.current.set(row.id, pay)
        return
      }
      const prev = seenTrip.current.get(row.id)
      const prevPay = seenPay.current.get(row.id)
      const statusSame = prev === row.status
      const paySame = prevPay === pay
      if (statusSame && paySame) return
      seenTrip.current.set(row.id, row.status)
      seenPay.current.set(row.id, pay)
      if (prev != null && pay === 'payment_required' && prevPay !== 'payment_required') {
        const owed = Number(row.metadata?.midride_cancel?.toCollectCents || row.metadata?.midride_cancel?.obligationCents) || 0
        const owedLabel = (owed / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
        pushToast({
          id: `pay-required-${row.id}`,
          kind: 'payment_required',
          force: true,
          title: 'Payment required',
          body: row.driver_id === user.id
            ? `Mid-ride cancel ended. ${owedLabel} is still unpaid.`
            : `The ride ended. ${owedLabel} still needs a card.`,
        })
      }
      if (statusSame) return
      if (prev == null && row.status === 'searching') {
        // first sight of a brand-new trip after prime — still toast
      } else if (prev == null) {
        // late discover of existing trip — skip noise
        return
      }
      let kind = TRIP_STATUS_KIND[row.status] || 'system'
      if (row.status === 'arriving' || row.status === 'arrived') kind = 'arrived_pickup'
      const titles = {
        ride_requested: 'Ride requested',
        driver_accepted: 'Driver accepted',
        driver_en_route: 'Driver en route',
        arrived_pickup: 'Arrived at pickup',
        trip_started: 'Trip started',
        trip_completed: 'Trip completed',
        canceled_midride: 'Ride canceled mid-trip',
        system: row.status === 'canceled'
          ? 'Trip canceled'
          : row.status === 'cancelled_wait'
            ? 'Canceled at pickup'
            : 'Trip update',
      }
      const midride = row.status === 'canceled_midride'
      const payout = row.metadata?.midride_cancel
      const money = (cents) => ((Number(cents) || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
      let body = tripBody(row)
      if (midride) {
        if (row.driver_id && row.driver_id === user.id && payout) {
          body = `Trip ended. You keep ${money(payout.driverCents)}.`
        } else if (payout) {
          body = `Trip ended. Charge ${money(payout.obligationCents)}.`
        } else {
          body = 'Trip ended. Live tracking is closed.'
        }
      }
      pushToast({
        id: `trip-${row.id}-${row.status}`,
        kind,
        title: titles[kind] || 'Trip update',
        body,
        force: midride,
      })
    }

    function onFriendRow(row) {
      if (!row?.id) return
      if (!primed.current) {
        seenFriend.current.set(row.id, row.status)
        return
      }
      const prev = seenFriend.current.get(row.id)
      if (prev === row.status) return
      seenFriend.current.set(row.id, row.status)
      if (prev == null) return
      if (row.kind === 'carpool' && (row.status === 'open' || row.status === 'booked' || row.status === 'active')) {
        pushToast({
          kind: 'carpool_booked',
          title: 'Carpool update',
          body: `Status: ${row.status}`,
        })
      } else {
        pushToast({
          kind: 'friend_joined',
          title: 'Friends ride update',
          body: `Status: ${row.status}`,
          category: 'friends',
        })
      }
    }

    function onBillRow(row) {
      if (!row?.id) return
      if (!primed.current) {
        seenBill.current.set(row.id, row.status)
        return
      }
      const prev = seenBill.current.get(row.id)
      if (prev === row.status) return
      seenBill.current.set(row.id, row.status)
      if (prev == null) return
      const cents = Number(row.amount_cents) || 0
      const dollars = (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
      if (/fail|error|unpaid/i.test(row.status || '')) {
        pushToast({ kind: 'payment_failed', title: 'Payment failed', body: dollars })
      } else if (/paid|succeeded|captured|charged/i.test(row.status || '')) {
        pushToast({ kind: 'fare_charged', title: 'Fare charged', body: dollars })
      } else if (/retry/i.test(row.status || '')) {
        pushToast({ kind: 'payment_retry', title: 'Retry payment', body: dollars })
      }
    }

    hydrate().catch(() => { primed.current = true })

    const channel = supabase
      .channel(`toasts-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trips', filter: `rider_id=eq.${user.id}` },
        (payload) => onTripRow(payload.new),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trips', filter: `driver_id=eq.${user.id}` },
        (payload) => onTripRow(payload.new),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'friend_rides', filter: `organizer_id=eq.${user.id}` },
        (payload) => onFriendRow(payload.new),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ride_bills', filter: `participant_profile_id=eq.${user.id}` },
        (payload) => onBillRow(payload.new),
      )
      .subscribe()

    // Poll fallback (Realtime may be disabled)
    const poll = setInterval(async () => {
      if (!alive || !primed.current) return
      try {
        const { data: trips } = await supabase
          .from('trips')
          .select('id, status, pickup_label, dropoff_label, rider_id, driver_id, metadata')
          .or(`rider_id.eq.${user.id},driver_id.eq.${user.id}`)
          .order('requested_at', { ascending: false })
          .limit(8)
        ;(trips || []).forEach(onTripRow)

        const { data: rides } = await supabase
          .from('friend_rides')
          .select('id, status, kind')
          .eq('organizer_id', user.id)
          .order('created_at', { ascending: false })
          .limit(5)
        ;(rides || []).forEach(onFriendRow)

        const { data: bills } = await supabase
          .from('ride_bills')
          .select('id, status, amount_cents')
          .eq('participant_profile_id', user.id)
          .order('created_at', { ascending: false })
          .limit(5)
        ;(bills || []).forEach(onBillRow)
      } catch {
        /* ignore poll errors */
      }
    }, 12000)

    return () => {
      alive = false
      clearInterval(poll)
      supabase.removeChannel(channel)
    }
  }, [user?.id])

  return null
}
