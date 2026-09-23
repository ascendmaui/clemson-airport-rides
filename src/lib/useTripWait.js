import { useEffect, useMemo, useRef, useState } from 'react'
import { quoteWait } from './waitFee'
import { tripWaitAction } from './tripWaitApi'

const TICK_MS = 10000

/**
 * Live wait quote aligned to server `arrived_at` + serverNow.
 * Both rider and driver render from the same timestamps, then advance locally
 * between ticks. Tick persists `wait_fee_cents` and auto-cancels at 7:00.
 */
const STATUS_RANK = {
  searching: 0,
  offered: 1,
  accepted: 2,
  arriving: 3,
  arrived: 4,
  in_progress: 5,
  completed: 6,
  cancelled_wait: 7,
  canceled: 7,
}

export function useTripWait(trip, onTrip) {
  const [anchor, setAnchor] = useState(null)
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [charge, setCharge] = useState(null)
  const onTripRef = useRef(onTrip)
  const tripRef = useRef(trip)
  const userLock = useRef(false)
  const autoTried = useRef(false)
  const chargeTried = useRef('')
  onTripRef.current = onTrip
  tripRef.current = trip

  const tripId = trip?.id || null
  const status = trip?.status || null
  const arrivedAt = trip?.arrived_at || null

  useEffect(() => {
    if (status !== 'arrived' || !arrivedAt) return undefined
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [status, arrivedAt])

  const quote = useMemo(() => {
    if (!arrivedAt) return quoteWait(null, now)
    if (!anchor || anchor.arrivedAt !== arrivedAt) return quoteWait(arrivedAt, now)
    const serverNow = anchor.serverNowMs + (now - anchor.clientNowMs)
    return quoteWait(arrivedAt, serverNow)
  }, [arrivedAt, anchor, now])

  function applyResult(res) {
    const next = res?.trip
    const current = tripRef.current
    const stale = Boolean(
      next && current && current.id === next.id
      && (STATUS_RANK[next.status] ?? 0) < (STATUS_RANK[current.status] ?? 0),
    )
    if (!stale && res?.serverNow && next?.arrived_at) {
      const serverNowMs = new Date(res.serverNow).getTime()
      if (Number.isFinite(serverNowMs)) {
        setAnchor({
          arrivedAt: next.arrived_at,
          serverNowMs,
          clientNowMs: Date.now(),
        })
        setNow(Date.now())
      }
    }
    if (res?.charge) setCharge(res.charge)
    if (next && !stale) onTripRef.current?.(next)
    return res
  }

  async function act(action, { silent = false } = {}) {
    if (!tripId) return null
    if (!silent && userLock.current) return null
    if (!silent) {
      userLock.current = true
      setBusy(true)
      setError(null)
    }
    try {
      const res = await tripWaitAction(action, tripId)
      return applyResult(res)
    } catch (e) {
      if (!silent) setError(e.message || 'Wait update failed')
      return null
    } finally {
      if (!silent) {
        userLock.current = false
        setBusy(false)
      }
    }
  }

  const actRef = useRef(act)
  actRef.current = act

  useEffect(() => {
    if (status !== 'arrived' || !tripId) {
      autoTried.current = false
      return undefined
    }
    let stop = false
    async function beat() {
      if (stop) return
      await actRef.current('tick', { silent: true })
    }
    beat()
    const id = setInterval(beat, TICK_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') beat()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stop = true
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [status, tripId])

  useEffect(() => {
    if (status !== 'arrived') {
      autoTried.current = false
      return
    }
    if (!quote.autoDue || autoTried.current) return
    autoTried.current = true
    actRef.current('tick', { silent: true })
  }, [quote.autoDue, status, tripId])

  useEffect(() => {
    if (status !== 'cancelled_wait' || !tripId) return
    const key = `${tripId}:cancelled_wait`
    if (chargeTried.current === key) return
    chargeTried.current = key
    actRef.current('tick', { silent: true })
  }, [status, tripId])

  return { quote, busy, error, charge, act }
}
