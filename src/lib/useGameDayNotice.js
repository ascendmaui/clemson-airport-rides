import { useEffect, useState } from 'react'
import { gameDayNotice } from '../../packages/rides-native/gameDayNotice.js'
import { getGameDayMultiplier } from './pricing'

export function useGameDayNotice() {
  const [notice, setNotice] = useState(() => gameDayNotice(null))
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let alive = true
    getGameDayMultiplier()
      .then(({ event }) => {
        if (alive) setNotice(gameDayNotice(event))
      })
      .catch(() => {
        if (alive) setNotice(gameDayNotice(null))
      })
      .finally(() => {
        if (alive) setReady(true)
      })
    return () => {
      alive = false
    }
  }, [])

  return { notice, ready }
}
