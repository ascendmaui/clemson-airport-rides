import assert from 'node:assert/strict'
import test, { afterEach, beforeEach, describe } from 'node:test'
import {
  DEFAULT_MAX_PARTICIPANTS,
  carpoolSeatCap,
  capacityMessage,
  inferVehicleCategory,
  loadRegisteredVehicle,
  offerCapacity,
  saveRegisteredVehicle,
  vehicleMaxSeats,
  vehicleTitle,
} from './vehicle.js'

describe('network isolation', () => {
  let originalFetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    globalThis.fetch = () => {
      throw new Error('Real network calls are forbidden in vehicle tests')
    }
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('vehicle module operates without network calls', () => {
    assert.equal(typeof capacityMessage, 'function')
    assert.equal(typeof vehicleTitle, 'function')
    assert.equal(typeof offerCapacity, 'function')
    assert.equal(typeof loadRegisteredVehicle, 'function')
    assert.equal(typeof saveRegisteredVehicle, 'function')
  })
})

describe('DEFAULT_MAX_PARTICIPANTS', () => {
  test('exports default participant count of 5', () => {
    assert.equal(DEFAULT_MAX_PARTICIPANTS, 5)
    assert.equal(typeof DEFAULT_MAX_PARTICIPANTS, 'number')
  })
})

describe('inferVehicleCategory', () => {
  test('infers van category from type, tier, make, or model keywords', () => {
    assert.equal(inferVehicleCategory({ model: 'Odyssey' }), 'van')
    assert.equal(inferVehicleCategory({ model: 'Sienna' }), 'van')
    assert.equal(inferVehicleCategory({ model: 'Pacifica' }), 'van')
    assert.equal(inferVehicleCategory({ model: 'Carnival' }), 'van')
    assert.equal(inferVehicleCategory({ model: 'Transit' }), 'van')
    assert.equal(inferVehicleCategory({ model: 'Caravan' }), 'van')
    assert.equal(inferVehicleCategory({ type: 'minivan' }), 'van')
    assert.equal(inferVehicleCategory({ tier: 'van' }), 'van')
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
    assert.equal(inferVehicleCategory({ model: 'Rogue' }), 'suv')
    assert.equal(inferVehicleCategory({ model: 'Pathfinder' }), 'suv')
    assert.equal(inferVehicleCategory({ model: 'Murano' }), 'suv')
    assert.equal(inferVehicleCategory({ model: 'Model Y' }), 'suv')
    assert.equal(inferVehicleCategory({ model: 'Model X' }), 'suv')
    assert.equal(inferVehicleCategory({ type: 'crossover' }), 'suv')
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

  test('handles case insensitivity, word boundaries, and unknown vehicles', () => {
    assert.equal(inferVehicleCategory({ make: 'HONDA', model: 'ODYSSEY' }), 'van')
    assert.equal(inferVehicleCategory({ make: 'Tesla', model: 'MODEL Y' }), 'suv')
    // BUG?: inferVehicleCategory defaults unknown vehicle models to 'sedan' rather than null or 'unknown'
    assert.equal(inferVehicleCategory({ make: 'Schwinn', model: 'Bicycle' }), 'sedan')
    assert.equal(inferVehicleCategory({}), 'sedan')
  })

  test('handles empty, null, and undefined inputs', () => {
    assert.equal(inferVehicleCategory(null), null)
    assert.equal(inferVehicleCategory(undefined), null)
    assert.equal(inferVehicleCategory(0), null)
    assert.equal(inferVehicleCategory(false), null)
    assert.equal(inferVehicleCategory(''), null)
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
    assert.equal(vehicleMaxSeats({}), 4) // general default: 4

    // BUG?: vehicleMaxSeats({ seats: 0 }) falls back to inferred category because 0 is not > 0, rather than clamping to 1
    assert.equal(vehicleMaxSeats({ seats: 0, model: 'Suburban' }), 7)
    assert.equal(vehicleMaxSeats({ seats: -2, model: 'Accord' }), 4)
    assert.equal(vehicleMaxSeats({ seats: NaN, model: 'Odyssey' }), 5)
    assert.equal(vehicleMaxSeats({ seats: 'invalid', model: 'Tahoe' }), 7)
  })

  test('returns DEFAULT_MAX_PARTICIPANTS when vehicle is null or undefined', () => {
    assert.equal(vehicleMaxSeats(null), DEFAULT_MAX_PARTICIPANTS)
    assert.equal(vehicleMaxSeats(undefined), DEFAULT_MAX_PARTICIPANTS)
    assert.equal(vehicleMaxSeats(0), DEFAULT_MAX_PARTICIPANTS)
    assert.equal(vehicleMaxSeats(false), DEFAULT_MAX_PARTICIPANTS)
  })
})

describe('carpoolSeatCap', () => {
  test('caps standard carpool to MAX_RIDERS (4)', () => {
    assert.equal(carpoolSeatCap({ kind: 'carpool', vehicleSeats: 4 }), 4)
    assert.equal(carpoolSeatCap({ kind: 'carpool', vehicleSeats: 6 }), 4)
    assert.equal(carpoolSeatCap({ kind: 'carpool', vehicleSeats: 8 }), 4)
    assert.equal(carpoolSeatCap({ kind: 'carpool', vehicleSeats: 2 }), 2)
  })

  test('allows up to 6 seats for tailgate with student_driver', () => {
    assert.equal(
      carpoolSeatCap({
        kind: 'carpool',
        partyType: 'tailgate',
        matchMode: 'student_driver',
        vehicleSeats: 7,
      }),
      6,
    )
    assert.equal(
      carpoolSeatCap({
        kind: 'carpool',
        partyType: 'tailgate',
        matchMode: 'student_driver',
        vehicleSeats: 5,
      }),
      5,
    )
    assert.equal(
      carpoolSeatCap({
        kind: 'carpool',
        partyType: 'tailgate',
        matchMode: 'student_driver',
        vehicleSeats: 2,
      }),
      2,
    )
  })

  test('tailgate without student_driver remains capped at 4', () => {
    assert.equal(
      carpoolSeatCap({
        kind: 'carpool',
        partyType: 'tailgate',
        matchMode: 'pro_driver',
        vehicleSeats: 7,
      }),
      4,
    )
  })

  test('handles non-carpool kinds and empty/null options', () => {
    assert.equal(carpoolSeatCap({ kind: 'solo', vehicleSeats: 3 }), 3)
    assert.equal(carpoolSeatCap({ kind: 'solo', vehicleSeats: 0 }), 5)
    assert.equal(carpoolSeatCap({ kind: 'solo', vehicleSeats: null }), 5)
    assert.equal(carpoolSeatCap({ kind: 'carpool' }), 4)
    // BUG?: carpoolSeatCap({}) without kind: 'carpool' defaults to 5 instead of MAX_RIDERS (4)
    assert.equal(carpoolSeatCap({}), 5)
    assert.equal(carpoolSeatCap(), 5)
  })
})

describe('capacityMessage', () => {
  test('returns standard message with total seats when hasVehicle is true', () => {
    assert.equal(capacityMessage(4), 'This vehicle seats up to 4 total (including you).')
    assert.equal(capacityMessage(6, { hasVehicle: true }), 'This vehicle seats up to 6 total (including you).')
    assert.equal(capacityMessage(1, { hasVehicle: true }), 'This vehicle seats up to 1 total (including you).')
  })

  test('returns prompt to add vehicle when hasVehicle is false', () => {
    assert.equal(
      capacityMessage(4, { hasVehicle: false }),
      'Add your vehicle before offering a group ride.',
    )
    assert.equal(
      capacityMessage(0, { hasVehicle: false }),
      'Add your vehicle before offering a group ride.',
    )
  })

  test('handles boundaries and invalid max values', () => {
    assert.equal(capacityMessage(0), 'This vehicle seats up to 0 total (including you).')
    // BUG?: capacityMessage interpolates null/undefined without fallback or formatting
    assert.equal(capacityMessage(null), 'This vehicle seats up to null total (including you).')
    assert.equal(capacityMessage(undefined), 'This vehicle seats up to undefined total (including you).')
    assert.equal(capacityMessage(), 'This vehicle seats up to undefined total (including you).')
    assert.equal(capacityMessage(NaN), 'This vehicle seats up to NaN total (including you).')
  })
})

describe('vehicleTitle', () => {
  test('formats full vehicle title with color, make, and model', () => {
    assert.equal(
      vehicleTitle({ color: 'White', make: 'Toyota', model: 'Sienna' }),
      'White Toyota Sienna',
    )
    assert.equal(
      vehicleTitle({ color: 'Midnight Blue', make: 'Tesla', model: 'Model 3' }),
      'Midnight Blue Tesla Model 3',
    )
  })

  test('formats partial vehicle title omitting missing fields', () => {
    assert.equal(vehicleTitle({ make: 'Honda', model: 'Civic' }), 'Honda Civic')
    assert.equal(vehicleTitle({ color: 'Red', make: 'Ford' }), 'Red Ford')
    assert.equal(vehicleTitle({ model: 'Corolla' }), 'Corolla')
  })

  test('normalizes multiple spaces and trims outer whitespace', () => {
    assert.equal(
      vehicleTitle({ color: '  Silver  ', make: '  Chevy  ', model: '  Suburban  ' }),
      'Silver Chevy Suburban',
    )
    assert.equal(
      vehicleTitle({ color: 'Dark   Grey', make: 'Mazda   ', model: 'CX-5' }),
      'Dark Grey Mazda CX-5',
    )
  })

  test('returns empty string for null, undefined, and empty objects', () => {
    assert.equal(vehicleTitle(null), '')
    assert.equal(vehicleTitle(undefined), '')
    assert.equal(vehicleTitle(''), '')
    assert.equal(vehicleTitle(0), '')
    assert.equal(vehicleTitle(false), '')
    assert.equal(vehicleTitle({}), '')
    assert.equal(vehicleTitle({ color: null, make: undefined, model: '' }), '')
  })
})

describe('offerCapacity', () => {
  test('returns full capacity summary for registered vehicle', () => {
    const vehicle = {
      color: 'Silver',
      make: 'Honda',
      model: 'Odyssey',
      plate: 'TIGER-1',
      seats: 7,
    }
    const res = offerCapacity(vehicle)
    assert.deepEqual(res, {
      seats: 7,
      cap: 4,
      title: 'Silver Honda Odyssey',
      plate: 'TIGER-1',
      message: 'This vehicle seats up to 7 total (including you).',
    })
  })

  test('caps tailgate student_driver offer up to 6 seats', () => {
    const vehicle = {
      color: 'Orange',
      make: 'Chevy',
      model: 'Tahoe',
      plate: 'DEATH-V',
      seats: 8,
    }
    const res = offerCapacity(vehicle, { tailgate: true })
    assert.equal(res.seats, 8)
    assert.equal(res.cap, 6)
    assert.equal(res.title, 'Orange Chevy Tahoe')
    assert.equal(res.plate, 'DEATH-V')
    assert.equal(res.message, 'This vehicle seats up to 8 total (including you).')
  })

  test('respects low seat counts on small cars even for tailgate', () => {
    const vehicle = {
      make: 'Mazda',
      model: 'Miata',
      seats: 2,
    }
    const res = offerCapacity(vehicle, { tailgate: true })
    assert.equal(res.seats, 2)
    assert.equal(res.cap, 2)
    assert.equal(res.plate, '')
    assert.equal(res.title, 'Mazda Miata')
  })

  test('infers category seats when seats field is omitted', () => {
    const vehicle = {
      make: 'Honda',
      model: 'Odyssey',
    }
    const res = offerCapacity(vehicle)
    assert.equal(res.seats, 5) // inferred van
    assert.equal(res.cap, 4)
  })

  test('returns null when vehicle is null or undefined', () => {
    assert.equal(offerCapacity(null), null)
    assert.equal(offerCapacity(undefined), null)
    assert.equal(offerCapacity(false), null)
    assert.equal(offerCapacity(0), null)
  })
})

describe('loadRegisteredVehicle', () => {
  test('returns null when supabase or userId is missing', async () => {
    assert.equal(await loadRegisteredVehicle(null, 'user-123'), null)
    assert.equal(await loadRegisteredVehicle({}, null), null)
    assert.equal(await loadRegisteredVehicle({}, ''), null)
    assert.equal(await loadRegisteredVehicle(undefined, undefined), null)
  })

  test('queries vehicles table with driver_id and returns row', async () => {
    const fakeRow = {
      id: 'veh-1',
      make: 'Toyota',
      model: 'RAV4',
      color: 'White',
      plate: 'SC-1234',
      seats: 5,
      is_tesla: false,
      tier: 'standard',
    }

    const calls = {
      table: null,
      columns: null,
      eqField: null,
      eqVal: null,
      orderField: null,
      orderOpts: null,
      limit: null,
    }

    const mockSupabase = {
      from(table) {
        calls.table = table
        return {
          select(cols) {
            calls.columns = cols
            return {
              eq(field, val) {
                calls.eqField = field
                calls.eqVal = val
                return {
                  order(orderField, opts) {
                    calls.orderField = orderField
                    calls.orderOpts = opts
                    return {
                      limit(n) {
                        calls.limit = n
                        return {
                          maybeSingle: async () => ({ data: fakeRow, error: null }),
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

    const res = await loadRegisteredVehicle(mockSupabase, 'driver-abc')
    assert.deepEqual(res, fakeRow)
    assert.equal(calls.table, 'vehicles')
    assert.equal(calls.columns, 'id, make, model, color, plate, seats, is_tesla, tier')
    assert.equal(calls.eqField, 'driver_id')
    assert.equal(calls.eqVal, 'driver-abc')
    assert.equal(calls.orderField, 'created_at')
    assert.deepEqual(calls.orderOpts, { ascending: false })
    assert.equal(calls.limit, 1)
  })

  test('returns null when no vehicle record exists', async () => {
    const mockSupabase = {
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

    const res = await loadRegisteredVehicle(mockSupabase, 'driver-new')
    assert.equal(res, null)
  })

  test('throws Error when database query returns error', async () => {
    const mockSupabase = {
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
                          maybeSingle: async () => ({
                            data: null,
                            error: { message: 'relation "vehicles" does not exist' },
                          }),
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

    await assert.rejects(
      () => loadRegisteredVehicle(mockSupabase, 'driver-err'),
      /relation "vehicles" does not exist/,
    )
  })
})

describe('saveRegisteredVehicle', () => {
  test('throws if supabase client is missing', async () => {
    await assert.rejects(
      () => saveRegisteredVehicle(null, 'u-1', { make: 'Ford', model: 'F150', plate: 'P1' }),
      /Supabase is not configured/,
    )
  })

  test('throws if userId is missing', async () => {
    const sb = { from() {} }
    await assert.rejects(
      () => saveRegisteredVehicle(sb, null, { make: 'Ford', model: 'F150', plate: 'P1' }),
      /Sign in required/,
    )
    await assert.rejects(
      () => saveRegisteredVehicle(sb, '', { make: 'Ford', model: 'F150', plate: 'P1' }),
      /Sign in required/,
    )
  })

  test('throws if required fields make, model, or plate are missing or whitespace', async () => {
    const sb = { from() {} }
    await assert.rejects(
      () => saveRegisteredVehicle(sb, 'u-1', { model: 'Camry', plate: 'SC1' }),
      /Make, model, and plate are required\./,
    )
    await assert.rejects(
      () => saveRegisteredVehicle(sb, 'u-1', { make: 'Toyota', plate: 'SC1' }),
      /Make, model, and plate are required\./,
    )
    await assert.rejects(
      () => saveRegisteredVehicle(sb, 'u-1', { make: 'Toyota', model: 'Camry' }),
      /Make, model, and plate are required\./,
    )
    await assert.rejects(
      () => saveRegisteredVehicle(sb, 'u-1', { make: '   ', model: 'Camry', plate: 'SC1' }),
      /Make, model, and plate are required\./,
    )
  })

  test('handles null or undefined payload by throwing TypeError', async () => {
    const sb = { from() {} }
    // BUG?: saveRegisteredVehicle throws TypeError if payload is null or undefined rather than throwing a validation error
    await assert.rejects(() => saveRegisteredVehicle(sb, 'u-1', null), TypeError)
    await assert.rejects(() => saveRegisteredVehicle(sb, 'u-1', undefined), TypeError)
  })

  test('inserts new vehicle when driver does not have an existing vehicle', async () => {
    let checkedUserId = null
    let insertPayload = null
    const insertedVehicle = {
      id: 'v-new-1',
      make: 'Honda',
      model: 'Civic',
      color: 'Black',
      plate: 'CLEM-1',
      seats: 4,
      is_tesla: false,
      tier: 'standard',
    }

    const mockSupabase = {
      from(table) {
        assert.equal(table, 'vehicles')
        return {
          select(cols) {
            if (cols === 'id') {
              return {
                eq(field, val) {
                  assert.equal(field, 'driver_id')
                  checkedUserId = val
                  return {
                    limit(n) {
                      assert.equal(n, 1)
                      return Promise.resolve({ data: [], error: null })
                    },
                  }
                },
              }
            }
            throw new Error(`Unexpected select: ${cols}`)
          },
          insert(payload) {
            insertPayload = payload
            return {
              select(cols) {
                assert.equal(cols, 'id, make, model, color, plate, seats, is_tesla, tier')
                return {
                  single: async () => ({ data: insertedVehicle, error: null }),
                }
              },
            }
          },
        }
      },
    }

    const result = await saveRegisteredVehicle(mockSupabase, 'driver-123', {
      make: ' Honda ',
      model: ' Civic ',
      color: ' Black ',
      plate: ' CLEM-1 ',
      seats: 4,
      isTesla: false,
    })

    assert.equal(checkedUserId, 'driver-123')
    assert.deepEqual(insertPayload, {
      driver_id: 'driver-123',
      make: 'Honda',
      model: 'Civic',
      color: 'Black',
      plate: 'CLEM-1',
      seats: 4,
      is_tesla: false,
      autonomous_capable: false,
      tier: 'standard',
    })
    assert.deepEqual(result, insertedVehicle)
  })

  test('updates existing vehicle when driver already has a vehicle', async () => {
    let updatePayload = null
    let updatedVehicleId = null
    const updatedVehicle = {
      id: 'v-existing-88',
      make: 'Tesla',
      model: 'Model Y',
      color: null,
      plate: 'TSLA-FUN',
      seats: 7,
      is_tesla: true,
      tier: 'tesla_self_driving',
    }

    const mockSupabase = {
      from(table) {
        assert.equal(table, 'vehicles')
        return {
          select(cols) {
            if (cols === 'id') {
              return {
                eq() {
                  return {
                    limit() {
                      return Promise.resolve({ data: [{ id: 'v-existing-88' }], error: null })
                    },
                  }
                },
              }
            }
            throw new Error(`Unexpected select: ${cols}`)
          },
          update(payload) {
            updatePayload = payload
            return {
              eq(field, val) {
                assert.equal(field, 'id')
                updatedVehicleId = val
                return {
                  select(cols) {
                    assert.equal(cols, 'id, make, model, color, plate, seats, is_tesla, tier')
                    return {
                      single: async () => ({ data: updatedVehicle, error: null }),
                    }
                  },
                }
              },
            }
          },
        }
      },
    }

    const result = await saveRegisteredVehicle(mockSupabase, 'driver-456', {
      make: 'Tesla',
      model: 'Model Y',
      color: '   ', // empty string trims to null
      plate: 'TSLA-FUN',
      seats: 7,
      isTesla: true,
    })

    assert.equal(updatedVehicleId, 'v-existing-88')
    assert.deepEqual(updatePayload, {
      make: 'Tesla',
      model: 'Model Y',
      color: null,
      plate: 'TSLA-FUN',
      seats: 7,
      is_tesla: true,
      autonomous_capable: false,
      tier: 'tesla_self_driving',
    })
    assert.deepEqual(result, updatedVehicle)
  })

  test('handles seats boundary parsing and defaults', async () => {
    let capturedFields = null
    const mockSupabase = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  limit() {
                    return Promise.resolve({ data: [], error: null })
                  },
                }
              },
            }
          },
          insert(payload) {
            capturedFields = payload
            return {
              select() {
                return {
                  single: async () => ({ data: payload, error: null }),
                }
              },
            }
          },
        }
      },
    }

    // Default seats when omitted or invalid
    await saveRegisteredVehicle(mockSupabase, 'u-1', { make: 'A', model: 'B', plate: 'C' })
    assert.equal(capturedFields.seats, 4)

    // Clamped upper bound at 8
    await saveRegisteredVehicle(mockSupabase, 'u-1', { make: 'A', model: 'B', plate: 'C', seats: 12 })
    assert.equal(capturedFields.seats, 8)

    // Clamped lower bound at 1
    await saveRegisteredVehicle(mockSupabase, 'u-1', { make: 'A', model: 'B', plate: 'C', seats: -5 })
    assert.equal(capturedFields.seats, 1)

    // BUG?: payload.seats = 0 evaluates to 4 because 0 is falsy (0 || 4 = 4), instead of clamping to 1
    await saveRegisteredVehicle(mockSupabase, 'u-1', { make: 'A', model: 'B', plate: 'C', seats: 0 })
    assert.equal(capturedFields.seats, 4)

    // Floating point floored
    await saveRegisteredVehicle(mockSupabase, 'u-1', { make: 'A', model: 'B', plate: 'C', seats: 6.9 })
    assert.equal(capturedFields.seats, 6)
  })

  test('propagates database read, insert, and update errors', async () => {
    // Read error
    const readErrSb = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  limit() {
                    return Promise.resolve({ data: null, error: { message: 'Read failure' } })
                  },
                }
              },
            }
          },
        }
      },
    }
    await assert.rejects(
      () => saveRegisteredVehicle(readErrSb, 'u-1', { make: 'A', model: 'B', plate: 'C' }),
      /Read failure/,
    )

    // Insert error
    const insertErrSb = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  limit() {
                    return Promise.resolve({ data: [], error: null })
                  },
                }
              },
            }
          },
          insert() {
            return {
              select() {
                return {
                  single: async () => ({ data: null, error: { message: 'Insert failure' } }),
                }
              },
            }
          },
        }
      },
    }
    await assert.rejects(
      () => saveRegisteredVehicle(insertErrSb, 'u-1', { make: 'A', model: 'B', plate: 'C' }),
      /Insert failure/,
    )

    // Update error
    const updateErrSb = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  limit() {
                    return Promise.resolve({ data: [{ id: 'veh-1' }], error: null })
                  },
                }
              },
            }
          },
          update() {
            return {
              eq() {
                return {
                  select() {
                    return {
                      single: async () => ({ data: null, error: { message: 'Update failure' } }),
                    }
                  },
                }
              },
            }
          },
        }
      },
    }
    await assert.rejects(
      () => saveRegisteredVehicle(updateErrSb, 'u-1', { make: 'A', model: 'B', plate: 'C' }),
      /Update failure/,
    )
  })
})
