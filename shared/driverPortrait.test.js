import assert from 'node:assert/strict'
import test from 'node:test'
import { demoDriverById } from './demoFleet.js'
import {
  nameInitials,
  renderDriverPortrait,
  resolveDriverPortrait,
} from './driverPortrait.js'

test('a real driver without avatar_url renders initials and never a demo photo', () => {
  const driver = {
    id: '11111111-1111-4111-8111-111111111111',
    full_name: 'Jordan Hale',
    avatar_url: null,
    isDemo: false,
  }
  const portrait = resolveDriverPortrait(driver)
  assert.equal(portrait.kind, 'initials')
  assert.equal(portrait.initials, 'JH')
  assert.equal(portrait.url, null)
  assert.equal(portrait.isDemo, false)
  assert.equal(String(portrait.url || '').includes('/demo-drivers/'), false)
  const markup = renderDriverPortrait(driver)
  assert.match(markup, /data-portrait="initials"/)
  assert.match(markup, />JH</)
  assert.equal(markup.includes('/demo-drivers/'), false)
})

test('a real driver keeps an uploaded photo and ignores a demo path', () => {
  const uploaded = resolveDriverPortrait({
    full_name: 'Amina Cole',
    avatar_url: 'https://cdn.example/amina.jpg',
  })
  assert.equal(uploaded.kind, 'photo')
  assert.equal(uploaded.url, 'https://cdn.example/amina.jpg')
  const blocked = resolveDriverPortrait({
    full_name: 'Sam Lee',
    avatar_url: '/demo-drivers/01-marcus.webp',
  })
  assert.equal(blocked.kind, 'initials')
  assert.equal(blocked.initials, 'SL')
  assert.equal(renderDriverPortrait(blocked).includes('/demo-drivers/'), false)
})

test('a demo driver resolves to that driver headshot', () => {
  const marcus = demoDriverById('demo-marcus')
  const portrait = resolveDriverPortrait(marcus)
  assert.equal(portrait.kind, 'photo')
  assert.equal(portrait.isDemo, true)
  assert.match(portrait.url, /^\/demo-drivers\/01-marcus@128\.webp$/)
  assert.equal(nameInitials('Mei'), 'M')
})

test('a demo id with no photo falls back to the fleet headshot', () => {
  const portrait = resolveDriverPortrait({ id: 'demo-jenna', full_name: 'Not Jenna' })
  assert.equal(portrait.kind, 'photo')
  assert.equal(portrait.isDemo, true)
  assert.equal(portrait.initials, null)
  assert.equal(portrait.url, '/demo-drivers/02-jenna@128.webp')
  const markup = renderDriverPortrait({ id: 'demo-jenna' })
  assert.match(markup, /src="\/demo-drivers\/02-jenna@128\.webp"/)
  assert.match(markup, /data-portrait="photo"/)
})

test('a demo record falls back from a missing small headshot to the large photo', () => {
  const largeOnly = resolveDriverPortrait({
    id: 'demo-unlisted',
    isDemo: true,
    firstName: 'Ada',
    photo: '/demo-drivers/ada.webp',
  })
  assert.equal(largeOnly.kind, 'photo')
  assert.equal(largeOnly.isDemo, true)
  assert.equal(largeOnly.url, '/demo-drivers/ada.webp')

  const prefersSmall = resolveDriverPortrait({
    id: 'demo-unlisted',
    source: 'demo',
    photoSmall: '/demo-drivers/ada@128.webp',
    photo: '/demo-drivers/ada.webp',
  })
  assert.equal(prefersSmall.url, '/demo-drivers/ada@128.webp')
  assert.equal(prefersSmall.isDemo, true)

  const blankSmall = resolveDriverPortrait({
    id: 'demo-unlisted',
    isDemo: true,
    photoSmall: '',
    photo: '/demo-drivers/ada.webp',
  })
  assert.equal(blankSmall.url, '/demo-drivers/ada.webp')
})

test('a catalog demo id keeps the fleet headshot when the caller also passes a photo', () => {
  const portrait = resolveDriverPortrait({
    id: 'demo-marcus',
    isDemo: true,
    photoSmall: '/demo-drivers/other@128.webp',
    photo: '/demo-drivers/other.webp',
    avatar_url: 'https://cdn.example/marcus.jpg',
  })
  assert.equal(portrait.kind, 'photo')
  assert.equal(portrait.isDemo, true)
  assert.equal(portrait.url, '/demo-drivers/01-marcus@128.webp')
})

test('a real driver uses avatarUrl and a blank avatar falls back to initials', () => {
  const camel = resolveDriverPortrait({
    full_name: 'Amina Cole',
    avatarUrl: 'https://cdn.example/amina.jpg',
  })
  assert.equal(camel.kind, 'photo')
  assert.equal(camel.url, 'https://cdn.example/amina.jpg')
  assert.equal(camel.isDemo, false)

  const blank = resolveDriverPortrait({
    full_name: 'Riley Quinn',
    avatar_url: '   ',
  })
  assert.equal(blank.kind, 'initials')
  assert.equal(blank.initials, 'RQ')
  assert.equal(blank.url, null)
  assert.equal(blank.isDemo, false)
  const markup = renderDriverPortrait({ full_name: 'Riley Quinn', avatar_url: '   ' })
  assert.match(markup, /data-portrait="initials"/)
  assert.match(markup, />RQ</)
  assert.equal(markup.includes('/demo-drivers/'), false)
})
