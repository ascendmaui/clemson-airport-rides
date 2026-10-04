import assert from 'node:assert/strict'
import test from 'node:test'
import { loadPublicDriverCards } from './driverCards.js'
import handleDriverCards from './endpoints/driverCards.js'

const DEMO = '0d2c7fa5-a098-4f2d-9ef4-35f70ea79218'

function cardsSb({ approved = true } = {}) {
  const selects = []
  const sb = {
    from(table) {
      return {
        select(columns) {
          selects.push({ table, columns })
          const result = () => {
            if (table === 'driver_applications') {
              return {
                data: approved ? [{ profile_id: DEMO }] : [],
                error: null,
              }
            }
            if (table === 'profiles') {
              return {
                data: [{
                  id: DEMO,
                  full_name: 'Demo Driver',
                  rating_avg: 0,
                  rating_count: 0,
                  standing: 'good',
                  email: 'hidden@example.com',
                  stripe_default_pm_id: 'pm_secret',
                }],
                error: null,
              }
            }
            if (table === 'vehicles') {
              return {
                data: [{
                  driver_id: DEMO,
                  color: 'gray',
                  make: 'Honda',
                  model: 'Accord',
                  plate: 'DEMO03',
                  tier: 'standard',
                  is_tesla: false,
                  stripe_account_id: 'acct_secret',
                }],
                error: null,
              }
            }
            return { data: [], error: null }
          }
          return {
            in() {
              return {
                eq: async () => result(),
                then(resolve, reject) {
                  return Promise.resolve(result()).then(resolve, reject)
                },
              }
            },
          }
        },
      }
    },
  }
  return { sb, selects }
}

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value
    },
    end(payload) {
      this.body = payload == null ? '' : String(payload)
    },
  }
}

test('loadPublicDriverCards returns the driver name and vehicle without billing columns', async () => {
  const { sb, selects } = cardsSb()
  const loaded = await loadPublicDriverCards(sb, [DEMO])
  assert.equal(loaded.error, null)
  assert.equal(loaded.drivers.length, 1)
  assert.equal(loaded.drivers[0].full_name, 'Demo Driver')
  assert.equal(loaded.drivers[0].make, 'Honda')
  assert.equal(loaded.drivers[0].model, 'Accord')
  assert.equal(loaded.drivers[0].plate, 'DEMO03')
  assert.equal(loaded.drivers[0].color, 'gray')
  assert.equal(loaded.drivers[0].dispatchRank, 2)
  const encoded = JSON.stringify(loaded.drivers)
  assert.equal(encoded.includes('pm_secret'), false)
  assert.equal(encoded.includes('acct_secret'), false)
  assert.equal(encoded.includes('hidden@example.com'), false)
  const profileSelect = selects.find((row) => row.table === 'profiles')
  assert.equal(profileSelect.columns.includes('stripe'), false)
  assert.equal(profileSelect.columns.includes('email'), false)
  const vehicleSelect = selects.find((row) => row.table === 'vehicles')
  assert.equal(vehicleSelect.columns.includes('stripe'), false)
})

test('loadPublicDriverCards omits drivers who are not approved', async () => {
  const { sb } = cardsSb({ approved: false })
  const loaded = await loadPublicDriverCards(sb, [DEMO])
  assert.deepEqual(loaded.drivers, [])
})

test('driver cards endpoint returns the safe card payload', async () => {
  const { sb } = cardsSb()
  const res = mockRes()
  await handleDriverCards({ method: 'POST', body: { ids: [DEMO] } }, res, { sb })
  assert.equal(res.statusCode, 200)
  const body = JSON.parse(res.body)
  assert.equal(body.drivers[0].full_name, 'Demo Driver')
  assert.equal(body.drivers[0].plate, 'DEMO03')
  assert.equal(JSON.stringify(body).includes('pm_secret'), false)
})
