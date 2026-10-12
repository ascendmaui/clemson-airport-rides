import { useEffect, useMemo, useRef, useState } from 'react'
import { buildGameDayExperience, loadGameDaySources, setGameDayPrepCheck } from './gameDayExperience.js'

export function useGameDayExperience(supabase, { driverId = null } = {}) {
  const [sources, setSources] = useState(null)
  const [checks, setChecks] = useState(null)
  const [now, setNow] = useState(() => new Date())
  const eventIdRef = useRef(null)

  useEffect(() => {
    let alive = true
    setSources(null)
    setChecks(null)
    loadGameDaySources(supabase, { driverId, now: new Date() })
      .then((next) => {
        if (alive) setSources(next)
      })
      .catch(() => {
        if (alive) setSources({})
      })
    return () => {
      alive = false
    }
  }, [supabase, driverId])

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(timer)
  }, [])

  const model = useMemo(() => buildGameDayExperience({
    ...(sources || {}),
    checkedIds: checks ?? sources?.checkedIds ?? [],
    now,
  }), [sources, checks, now])

  eventIdRef.current = model.eventId

  function togglePrep(itemId) {
    setChecks((prev) => {
      const base = prev ?? sources?.checkedIds ?? []
      const has = base.includes(itemId)
      const eventId = eventIdRef.current
      if (driverId && eventId) {
        void setGameDayPrepCheck(supabase, { driverId, eventId, itemId, checked: !has })
      }
      return has ? base.filter((id) => id !== itemId) : [...base, itemId]
    })
  }

  return { model, ready: sources != null, togglePrep }
}
