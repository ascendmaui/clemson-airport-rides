import { useEffect, useRef, useState } from 'react'
import { fetchActiveIncentiveState, recordIncentivePresence } from '../lib/driverIncentives'
import { zonedParts } from '../lib/driverIncentiveMath'
import { pushToast } from '../lib/toasts'

const TOAST_KEY = 'clemson.driver_incentive_toasts'

function loadToasted() {
  try {
    return JSON.parse(localStorage.getItem(TOAST_KEY) || '{}')
  } catch {
    return {}
  }
}

/**
 * Banner entry for the driver home / earnings surface.
 * Copy is the driver incentive ("1.5x earnings"), never rider surge.
 */
export function DriverIncentiveBanner({ text }) {
  if (!text) return null
  return (
    <div
      role="status"
      data-incentive-banner="1"
      style={{
        padding: '10px 14px',
        borderRadius: 14,
        background: 'linear-gradient(135deg, #F56600 0%, #522D80 100%)',
        color: '#fff',
        fontWeight: 700,
        fontSize: 14,
        lineHeight: 1.35,
        boxShadow: '0 8px 22px rgba(82,45,128,0.28)',
      }}
    >
      {text}
    </div>
  )
}

export function useDriverIncentiveWatch({ driverId, online }) {
  const [banner, setBanner] = useState('')
  const [rows, setRows] = useState([])
  const toasted = useRef(loadToasted())

  useEffect(() => {
    if (!online) return undefined
    let alive = true

    async function tick() {
      const state = await fetchActiveIncentiveState()
      if (!alive) return
      setBanner(state.banner)
      setRows(state.rows)
      if (!driverId || !state.rows.length || !state.banner) return
      recordIncentivePresence(driverId, state.rows).catch(() => {})
      const day = zonedParts(new Date()).date
      const fresh = state.rows.filter((row) => !toasted.current[`${row.id}:${day}`])
      if (!fresh.length) return
      for (const row of fresh) toasted.current[`${row.id}:${day}`] = true
      try {
        localStorage.setItem(TOAST_KEY, JSON.stringify(toasted.current))
      } catch {
        /* ignore */
      }
      pushToast({
        kind: 'driver_incentive',
        category: 'system',
        title: 'Driver incentive',
        body: state.banner,
        tone: 'orange',
      })
    }

    tick()
    const timer = setInterval(tick, 30000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [driverId, online])

  return { banner, rows }
}
