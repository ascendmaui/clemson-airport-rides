import { useEffect, useState } from 'react'
import { SIMULATED_FLEET_TICK_MS, simulatedFleetAt } from './simulatedDrivers.js'

/** Positions for the demo cars. Empty when the rider map is not showing them. Pauses while active is false. */
export function useSimulatedFleet(enabled, active = true) {
  const [fleet, setFleet] = useState(() => (enabled ? simulatedFleetAt(Date.now()) : []))
  useEffect(() => {
    if (!enabled) {
      setFleet((current) => (current.length ? [] : current))
      return undefined
    }
    if (!active) return undefined
    const tick = () => setFleet(simulatedFleetAt(Date.now()))
    tick()
    const id = setInterval(tick, SIMULATED_FLEET_TICK_MS)
    return () => clearInterval(id)
  }, [enabled, active])
  return fleet
}
