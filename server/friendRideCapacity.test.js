import assert from 'node:assert/strict'
import test, { describe } from 'node:test'
import {
  DEFAULT_MAX_PARTICIPANTS,
  inferVehicleCategory,
  loadDriverVehicle,
  vehicleFareMultiplier,
  vehicleMaxSeats,
} from './friendRideCapacity.js'

describe('DEFAULT_MAX_PARTICIPANTS', () => {
  test('exports default participant count of 5', () => {
    assert.equal(DEFAULT_MAX_PARTICIPANTS, 5)
    assert.equal(typeof DEFAULT_MAX_PARTICIPANTS, 'number')
  })
})

describe('inferVehicleCategory', () => {
  test('returns null for null, undefined, and non-object falsy values', () => {
    assert.equal(inferVehicleCategory(null), null)
    assert.equal(inferVehicleCategory(undefined), null)
    assert.equal(inferVehicleCategory(0), null)
    assert.equal(inferVehicleCategory(false), null)
    assert.equal(inferVehicleCategory(''), null)
  })

  test('infers van category from type, tier, make, or model keywords', () => {
    assert.equal(inferVehicleCategory({ model: 'Odyssey' }), 'van')
    assert.equal(inferVehicleCategory({ model: 'Sienna' }), 'van')
    assert.equal(inferVehicleCategory({ model: 'Pacifica' }), 'van')
    assert.equal(inferVehicleCategory({ model: 'Carnival' }), 'van')
    assert.equal(inferVehicleCategory({ model: 'Transit' }), 'van')
    assert.equal(inferVehicleCategory({ model: 'Caravan' }), 'van')
    assert.equal(inferVehicleCategory({ type: 'minivan' }), 'van')
    assert.equal(inferVehicleCategory({ tier: 'van' }), 'van')
    assert.equal(inferVehicleCategory({ make: 'Ford', model: 'Transit Connect' }), 'van')
  })

  test('infers suv category from common SUV and crossover models', () => {
    assert.equal(inferVehicleCategory({ model: 'Suburban' }), 'suv')
    assert.equal(inferVehicleCategory({ model: 'Tahoe' }), 'suv')
    assert.equal(inferVehicleCategory({ model: 'Explorer' }), 'suv')
    assert.equal(inferVehicleCategory({ model: 'Highlander' }), 'suv')
    assert.equal(inferVehicleCategory({ model: 'Pilot' }), 'suv')
    assert.equal(inferVehicleCategory({ model: '4Runner' }), 'suv')
    assert.equal(inferVehicleCategory({ model: 'Traverse' }), 'suv')
    assert.equal(inferVehicleCategory({ model: 'Durango' }), 'suv')
    assert.equal(inferVehicleCategory({ model: 'Escalade' }), 'suv')
    assert.equal(inferVehicleCategory({ model: 'Yukon' }), 'suv')
    assert.equal(inferVehicleCategory({ model: 'Wrangler' }), 'suv')
    assert.equal(inferVehicleCategory({ model: 'Bronco' }), 'suv')
    assert.equal(inferVehicleCategory({ model: 'RAV4' }), 'suv')
    assert.equal(inferVehicleCategory({ model: 'CR-V' }), 'suv')
    assert.equal(inferVehicleCategory({ model: 'CRV' }), 'suv')
    assert.equal(inferVehicleCategory({ model: 'CX-5' }), 'suv')
    assert.equal(inferVehicleCategory({ model: 'CX5' }), 'suv')
    assert.equal(inferVehicleCategory({ model: 'CX-9' }), 'suv')
    assert.equal(inferVehicleCategory({ model: 'CX9' }), 'suv')
    assert.equal(inferVehicleCategory({ model: 'Rogue' }), 'suv')
    assert.equal(inferVehicleCategory({ model: 'Pathfinder' }), 'suv')
    assert.equal(inferVehicleCategory({ model: 'Murano' }), 'suv')
    assert.equal(inferVehicleCategory({ model: 'Model Y' }), 'suv')
    assert.equal(inferVehicleCategory({ model: 'Model X' }), 'suv')
    assert.equal(inferVehicleCategory({ type: 'crossover' }), 'suv')
    assert.equal(inferVehicleCategory({ tier: 'suv' }), 'suv')
  })

  test('infers sedan category from sedan models and keywords', () => {
    assert.equal(inferVehicleCategory({ model: 'Camry' }), 'sedan')
    assert.equal(inferVehicleCategory({ model: 'Accord' }), 'sedan')
    assert.equal(inferVehicleCategory({ model: 'Civic' }), 'sedan')
    assert.equal(inferVehicleCategory({ model: 'Corolla' }), 'sedan')
    assert.equal(inferVehicleCategory({ model: 'Altima' }), 'sedan')
    assert.equal(inferVehicleCategory({ model: 'Malibu' }), 'sedan')
    assert.equal(inferVehicleCategory({ model: 'Sonata' }), 'sedan')
    assert.equal(inferVehicleCategory({ model: 'Elantra' }), 'sedan')
    assert.equal(inferVehicleCategory({ model: 'Model 3' }), 'sedan')
    assert.equal(inferVehicleCategory({ model: 'Model S' }), 'sedan')
    assert.equal(inferVehicleCategory({ type: 'sedan' }), 'sedan')
  })

  test('handles case insensitivity across fields', () => {
    assert.equal(inferVehicleCategory({ make: 'HONDA', model: 'ODYSSEY' }), 'van')
    assert.equal(inferVehicleCategory({ make: 'Tesla', model: 'MODEL Y' }), 'suv')
    assert.equal(inferVehicleCategory({ make: 'TOYOTA', model: 'CAMRY' }), 'sedan')
  })

  test('falls back to sedan for unknown vehicles and empty objects', () => {
    // BUG?: inferVehicleCategory defaults unknown vehicle models to 'sedan' rather than null or 'unknown'
    assert.equal(inferVehicleCategory({ make: 'Schwinn', model: 'Bicycle' }), 'sedan')
    assert.equal(inferVehicleCategory({ make: 'Unknown', model: 'Mystery Car' }), 'sedan')
    assert.equal(inferVehicleCategory({}), 'sedan')
  })
})

describe('vehicleMaxSeats', () => {
  test('returns explicit seats when valid positive integer', () => {
    assert.equal(vehicleMaxSeats({ seats: 4 }), 4)
    assert.equal(vehicleMaxSeats({ seats: 6 }), 6)
    assert.equal(vehicleMaxSeats({ seats: 8 }), 8)
    assert.equal(vehicleMaxSeats({ seats: '5' }), 5)
  })

  test('clamps explicit seats between 1 and 8', () => {
    assert.equal(vehicleMaxSeats({ seats: 1 }), 1)
    assert.equal(vehicleMaxSeats({ seats: 9 }), 8)
    assert.equal(vehicleMaxSeats({ seats: 12 }), 8)
    assert.equal(vehicleMaxSeats({ seats: 0.8 }), 1)
  })

  test('falls back to category defaults when seats is omitted or non-positive', () => {
    assert.equal(vehicleMaxSeats({ model: 'Odyssey' }), 5) // van default: 5
    assert.equal(vehicleMaxSeats({ model: 'Suburban' }), 7) // suv default: 7
    assert.equal(vehicleMaxSeats({ model: 'Civic' }), 4) // sedan default: 4
    assert.equal(vehicleMaxSeats({}), 4) // fallback sedan: 4

    // BUG?: vehicleMaxSeats({ seats: 0 }) falls back to inferred category because 0 is not > 0, rather than clamping to 1
    assert.equal(vehicleMaxSeats({ seats: 0, model: 'Suburban' }), 7)
    assert.equal(vehicleMaxSeats({ seats: -2, model: 'Accord' }), 4)
    assert.equal(vehicleMaxSeats({ seats: NaN, model: 'Odyssey' }), 5)
    assert.equal(vehicleMaxSeats({ seats: 'invalid', model: 'Tahoe' }), 7)
  })

  test('returns DEFAULT_MAX_PARTICIPANTS when vehicle is null or undefined', () => {
    // BUG?: vehicleMaxSeats(null) returns DEFAULT_MAX_PARTICIPANTS (5) instead of sedan default (4)
    assert.equal(vehicleMaxSeats(null), DEFAULT_MAX_PARTICIPANTS)
    assert.equal(vehicleMaxSeats(undefined), DEFAULT_MAX_PARTICIPANTS)
    assert.equal(vehicleMaxSeats(0), DEFAULT_MAX_PARTICIPANTS)
    assert.equal(vehicleMaxSeats(false), DEFAULT_MAX_PARTICIPANTS)
  })
})

describe('vehicleFareMultiplier', () => {
  test('calculates multiplier for party of 1 across vehicle categories', () => {
    assert.equal(Number(vehicleFareMultiplier({ model: 'Civic' }, 1).toFixed(4)), 1.0)
    assert.equal(Number(vehicleFareMultiplier({ model: 'Odyssey' }, 1).toFixed(4)), 1.05)
    assert.equal(Number(vehicleFareMultiplier({ model: 'Tahoe' }, 1).toFixed(4)), 1.08)
    assert.equal(Number(vehicleFareMultiplier(null, 1).toFixed(4)), 1.0)
  })

  test('defaults partySize to 1 when omitted or falsy', () => {
    assert.equal(Number(vehicleFareMultiplier({ model: 'Civic' }).toFixed(4)), 1.0)
    assert.equal(Number(vehicleFareMultiplier({ model: 'Odyssey' }).toFixed(4)), 1.05)
    assert.equal(Number(vehicleFareMultiplier({ model: 'Tahoe' }).toFixed(4)), 1.08)
    assert.equal(Number(vehicleFareMultiplier({ model: 'Tahoe' }, 0).toFixed(4)), 1.08)
    assert.equal(Number(vehicleFareMultiplier({ model: 'Tahoe' }, -2).toFixed(4)), 1.08)
    assert.equal(Number(vehicleFareMultiplier({ model: 'Tahoe' }, null).toFixed(4)), 1.08)
  })

  test('party of 2 does not incur extra passenger multiplier', () => {
    assert.equal(Number(vehicleFareMultiplier({ model: 'Civic' }, 2).toFixed(4)), 1.0)
    assert.equal(Number(vehicleFareMultiplier({ model: 'Odyssey' }, 2).toFixed(4)), 1.05)
    assert.equal(Number(vehicleFareMultiplier({ model: 'Tahoe' }, 2).toFixed(4)), 1.08)
  })

  test('calculates multiplier for party of 4 (>=3 party multiplier 1.02x)', () => {
    // sedan: 1.0 * 1.02 = 1.02
    assert.equal(Number(vehicleFareMultiplier({ model: 'Civic' }, 4).toFixed(4)), 1.02)
    // van: 1.05 * 1.02 = 1.071
    assert.equal(Number(vehicleFareMultiplier({ model: 'Odyssey' }, 4).toFixed(4)), 1.071)
    // suv: 1.08 * 1.02 = 1.1016
    assert.equal(Number(vehicleFareMultiplier({ model: 'Tahoe' }, 4).toFixed(4)), 1.1016)
    // null vehicle (defaults to sedan): 1.0 * 1.02 = 1.02
    assert.equal(Number(vehicleFareMultiplier(null, 4).toFixed(4)), 1.02)
  })

  test('calculates multiplier for party of 5 (>=5 party multiplier 1.04x)', () => {
    // sedan: 1.0 * 1.04 = 1.04
    assert.equal(Number(vehicleFareMultiplier({ model: 'Civic' }, 5).toFixed(4)), 1.04)
    // van: 1.05 * 1.04 = 1.092
    assert.equal(Number(vehicleFareMultiplier({ model: 'Odyssey' }, 5).toFixed(4)), 1.092)
    // suv: 1.08 * 1.04 = 1.1232
    assert.equal(Number(vehicleFareMultiplier({ model: 'Tahoe' }, 5).toFixed(4)), 1.1232)
    // null vehicle: 1.0 * 1.04 = 1.04
    assert.equal(Number(vehicleFareMultiplier(null, 5).toFixed(4)), 1.04)
  })

  test('calculates multiplier for party of 6 (>=5 party multiplier 1.04x)', () => {
    assert.equal(Number(vehicleFareMultiplier({ model: 'Civic' }, 6).toFixed(4)), 1.04)
    assert.equal(Number(vehicleFareMultiplier({ model: 'Odyssey' }, 6).toFixed(4)), 1.092)
    assert.equal(Number(vehicleFareMultiplier({ model: 'Tahoe' }, 6).toFixed(4)), 1.1232)
  })

  test('calculates multiplier for party of 8 (>=5 party multiplier 1.04x)', () => {
    // BUG?: vehicleFareMultiplier does not enforce partySize <= vehicle capacity (e.g. party of 8 in a 4-seat sedan calculates without error)
    // BUG?: vehicleFareMultiplier party tier is capped at 1.04 for partySize >= 5 and does not scale further for 6 or 8 passengers
    assert.equal(Number(vehicleFareMultiplier({ model: 'Civic' }, 8).toFixed(4)), 1.04)
    assert.equal(Number(vehicleFareMultiplier({ model: 'Odyssey' }, 8).toFixed(4)), 1.092)
    assert.equal(Number(vehicleFareMultiplier({ model: 'Tahoe' }, 8).toFixed(4)), 1.1232)
  })
})

describe('loadDriverVehicle', () => {
  test('returns null when driverId is missing or empty', async () => {
    assert.equal(await loadDriverVehicle({}, null), null)
    assert.equal(await loadDriverVehicle({}, undefined), null)
    assert.equal(await loadDriverVehicle({}, ''), null)
  })

  test('queries vehicles table with driver_id and returns vehicle record', async () => {
    const fakeVehicle = {
      id: 'veh-99',
      make: 'Toyota',
      model: 'Sienna',
      color: 'Silver',
      plate: 'TIGER-VAN',
      seats: 7,
      is_tesla: false,
      tier: 'standard',
    }

    let queriedTable = null
    let queriedCols = null
    let eqField = null
    let eqVal = null
    let orderField = null
    let orderOpts = null
    let limitVal = null

    const mockSb = {
      from(table) {
        queriedTable = table
        return {
          select(cols) {
            queriedCols = cols
            return {
              eq(field, val) {
                eqField = field
                eqVal = val
                return {
                  order(orderCol, opts) {
                    orderField = orderCol
                    orderOpts = opts
                    return {
                      limit(n) {
                        limitVal = n
                        return {
                          maybeSingle: async () => ({ data: fakeVehicle, error: null }),
                        }
                      },
                    }
                  },
                }
              },
            }
          },
        }
      },
    }

    const result = await loadDriverVehicle(mockSb, 'driver-42')
    assert.deepEqual(result, fakeVehicle)
    assert.equal(queriedTable, 'vehicles')
    assert.equal(queriedCols, 'id, make, model, color, plate, seats, is_tesla, tier')
    assert.equal(eqField, 'driver_id')
    assert.equal(eqVal, 'driver-42')
    assert.equal(orderField, 'created_at')
    assert.deepEqual(orderOpts, { ascending: false })
    assert.equal(limitVal, 1)
  })

  test('returns null when no vehicle record is found for driver', async () => {
    const mockSb = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  order() {
                    return {
                      limit() {
                        return {
                          maybeSingle: async () => ({ data: null, error: null }),
                        }
                      },
                    }
                  },
                }
              },
            }
          },
        }
      },
    }

    const result = await loadDriverVehicle(mockSb, 'driver-none')
    assert.equal(result, null)
  })
})

describe('party size capacity limits (party of 1, 4, 5, 6, 8)', () => {
  const sedan = { model: 'Civic' } // max 4
  const van = { model: 'Odyssey' } // max 5
  const suv = { model: 'Suburban' } // max 7

  test('party of 1 fits within all vehicle categories', () => {
    assert.equal(1 <= vehicleMaxSeats(sedan), true)
    assert.equal(1 <= vehicleMaxSeats(van), true)
    assert.equal(1 <= vehicleMaxSeats(suv), true)
    assert.equal(1 <= vehicleMaxSeats(null), true)
  })

  test('party of 4 fits within sedan, van, and SUV capacity', () => {
    assert.equal(4 <= vehicleMaxSeats(sedan), true)
    assert.equal(4 <= vehicleMaxSeats(van), true)
    assert.equal(4 <= vehicleMaxSeats(suv), true)
    assert.equal(4 <= vehicleMaxSeats(null), true)
  })

  test('party of 5 exceeds standard sedan (4) but fits van (5) and SUV (7)', () => {
    assert.equal(5 <= vehicleMaxSeats(sedan), false)
    assert.equal(5 <= vehicleMaxSeats(van), true)
    assert.equal(5 <= vehicleMaxSeats(suv), true)
    assert.equal(5 <= vehicleMaxSeats(null), true) // DEFAULT_MAX_PARTICIPANTS = 5
  })

  test('party of 6 exceeds sedan (4) and van (5) but fits SUV (7)', () => {
    assert.equal(6 <= vehicleMaxSeats(sedan), false)
    assert.equal(6 <= vehicleMaxSeats(van), false)
    assert.equal(6 <= vehicleMaxSeats(suv), true)
    assert.equal(6 <= vehicleMaxSeats(null), false)
  })

  test('party of 8 exceeds standard category capacities (sedan 4, van 5, SUV 7, default 5)', () => {
    assert.equal(8 <= vehicleMaxSeats(sedan), false)
    assert.equal(8 <= vehicleMaxSeats(van), false)
    assert.equal(8 <= vehicleMaxSeats(suv), false)
    assert.equal(8 <= vehicleMaxSeats(null), false)
  })

  test('party of 8 fits only when vehicle has explicit 8 seats configured', () => {
    const eightSeatVan = { model: 'Odyssey', seats: 8 }
    assert.equal(8 <= vehicleMaxSeats(eightSeatVan), true)
  })
})
