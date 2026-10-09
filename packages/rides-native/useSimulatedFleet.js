import { useEffect, useState } from 'react'
import { SIMULATED_FLEET_TICK_MS, simulatedFleetAt } from './simulatedDrivers.js'

/** Positions for the demo cars. Empty when the rider map is not showing them. */
export function useSimulatedFleet(enabled) {
  const [fleet, setFleet] = useState(() => (enabled ? simulatedFleetAt(Date.now()) : []))
  useEffect(() => {
    if (!enabled) {
      setFleet((current) => (current.length ? [] : current))
      return undefined
    }
    const tick = () => setFleet(simulatedFleetAt(Date.now()))
    tick()
    const id = setInterval(tick, SIMULATED_FLEET_TICK_MS)
    return () => clearInterval(id)
  }, [enabled])
  return fleet
}
