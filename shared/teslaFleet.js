/** Fleet eligibility follows the vehicle on file, never a legacy badge. */
export function isTeslaModel3(vehicle) {
  return String(vehicle?.make || '').trim().toLowerCase() === 'tesla'
    && /^model\s*3$/i.test(String(vehicle?.model || '').trim())
}

// Premium class applied before surge, using the existing vehicle multiplier.
export const TESLA_FARE_MULTIPLIER = 2
