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
