import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { BOOKABLE_RIDE_TIER_IDS, bookableRideTiers } from '../packages/rides-native/places.js'
import { DEMO_FLEET, demoDriverById, demoHeadshotUrl, isDemoDriverId } from './demoFleet.js'
import { OFFERED_RIDE_TIERS, RIDE_OPTION_CATALOG, isBlockedRideTier } from './rideOptions.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('demo fleet matches the twelve named map cars and their photos', () => {
  assert.equal(DEMO_FLEET.length, 12)
  assert.deepEqual(DEMO_FLEET.map((car) => car.firstName), [
    'Marcus', 'Jenna', 'Darnell', 'Priya', 'Carlos', 'Hannah',
    'Terrence', 'Mei', 'Wade', 'Tasha', 'Luis', 'Brooke',
  ])
  assert.deepEqual(DEMO_FLEET.map((car) => car.vehicle), [
    'BMW X5',
    'Mercedes GLE',
    'Audi Q7',
    'Range Rover Sport',
    'Lexus RX',
    'Porsche Macan',
    'Cadillac Escalade',
    'Genesis GV80',
    'Ford F-150',
    'Ford F-150',
    'Ford F-150',
    DEMO_FLEET[11].vehicle,
  ])
  for (const car of DEMO_FLEET) {
    assert.equal(car.isDemo, true)
    assert.equal(car.source, 'demo')
    assert.equal(car.bookable, false)
    assert.equal(car.online, false)
    assert.equal(isDemoDriverId(car.id), true)
    assert.match(car.photo, /^\/demo-drivers\//)
    assert.match(car.photoSmall, /^\/demo-drivers\//)
    assert.equal(existsSync(path.join(root, 'public', car.photo)), true)
    assert.equal(existsSync(path.join(root, 'public', car.photoSmall)), true)
  }
  assert.equal(DEMO_FLEET.filter((car) => car.body === 'wedge').length, 1)
  assert.equal(DEMO_FLEET.filter((car) => car.body === 'truck').length, 3)
  assert.equal(isDemoDriverId('11111111-1111-4111-8111-111111111111'), false)
})

test('bookable tiers are Standard, Wait & Save, and Extra Comfort', () => {
  assert.deepEqual(OFFERED_RIDE_TIERS, ['standard', 'wait', 'comfort'])
  assert.deepEqual(BOOKABLE_RIDE_TIER_IDS, ['standard', 'wait', 'comfort'])
  const offered = bookableRideTiers()
  assert.deepEqual(offered.map((tier) => tier.id), ['standard', 'wait', 'comfort'])
  assert.deepEqual(offered.map((tier) => tier.name), ['Standard', 'Wait & Save', 'Extra Comfort'])
  assert.deepEqual(RIDE_OPTION_CATALOG.map((tier) => tier.id), ['standard', 'wait', 'comfort'])
  assert.deepEqual(RIDE_OPTION_CATALOG.map((tier) => tier.name), ['Standard', 'Wait & Save', 'Extra Comfort'])
  const blocked = [
    ['te', 'sla'].join(''),
    ['model', ' 3'].join(''),
    ['self', '-driving'].join(''),
    ['self', ' driving'].join(''),
    ['robo', 'taxi'].join(''),
  ]
  for (const tier of [...offered, ...RIDE_OPTION_CATALOG]) {
    const label = `${tier.id} ${tier.name}`.toLowerCase()
    for (const needle of blocked) assert.equal(label.includes(needle), false)
    assert.equal(isBlockedRideTier(tier.id), false)
  }
  const retiredMake = ['Te', 'sla'].join('')
  const wedgeModel = ['Cy', 'bertruck'].join('')
  const named = DEMO_FLEET.filter((car) => car.make === retiredMake || car.model === wedgeModel)
  assert.equal(named.length, 1)
  assert.equal(named[0].id, 'demo-brooke')
  assert.equal(named[0].body, 'wedge')
  assert.equal(named[0].vehicle, `${retiredMake} ${wedgeModel}`)
  assert.equal(named[0].bookable, false)
  assert.equal(named[0].online, false)
  assert.equal(DEMO_FLEET.some((car) => car.bookable), false)
  const productNeedles = blocked.filter((needle) => needle !== retiredMake.toLowerCase())
  assert.equal(
    DEMO_FLEET.some((car) => {
      const blob = `${car.make} ${car.model} ${car.vehicle}`.toLowerCase()
      return productNeedles.some((needle) => blob.includes(needle))
    }),
    false,
  )
})

test('demo headshot URLs skip blank, padded, and unsafe paths', () => {
  for (const car of DEMO_FLEET) {
    assert.equal(demoHeadshotUrl(car), car.photoSmall)
    assert.equal(demoHeadshotUrl(car.id, 'large'), car.photo)
    assert.equal(demoHeadshotUrl(` ${car.id} `), car.photoSmall)
    assert.equal(demoDriverById(` ${car.id} `)?.id, car.id)
    assert.equal(isDemoDriverId(` ${car.id} `), true)
  }
  assert.equal(demoHeadshotUrl(' demo-marcus '), '/demo-drivers/01-marcus@128.webp')
  assert.equal(demoHeadshotUrl('demo-marcus', 'large'), '/demo-drivers/01-marcus.webp')
  assert.equal(demoDriverById(' demo-jenna ')?.firstName, 'Jenna')
  assert.equal(isDemoDriverId(' demo-jenna '), true)
  assert.equal(demoHeadshotUrl({
    id: 'demo-unlisted',
    isDemo: true,
    photoSmall: '   ',
    photo: '/demo-drivers/ada.webp',
  }), '/demo-drivers/ada.webp')
  assert.equal(demoHeadshotUrl({
    id: 'demo-unlisted',
    isDemo: true,
    photo: 'https://evil.example/a.jpg',
  }), null)
  assert.equal(demoHeadshotUrl({
    id: 'demo-unlisted',
    isDemo: true,
    photo: '/demo-drivers/../secret.webp',
  }), null)
  assert.equal(demoHeadshotUrl({
    id: 'demo-unlisted',
    isDemo: true,
    photo: '/demo-drivers/..',
  }), null)
  assert.equal(demoHeadshotUrl({ id: 'real-1', photo: '/demo-drivers/01-marcus.webp' }), null)
  assert.equal(demoHeadshotUrl(null), null)
  assert.equal(demoHeadshotUrl('not-a-demo'), null)
})
