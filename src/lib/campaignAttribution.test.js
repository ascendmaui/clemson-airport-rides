import assert from 'node:assert/strict'
import test from 'node:test'
import { adLeadEmail, adLeadRow } from '../../shared/adLeads.js'
import {
  captureCampaignAttribution,
  formatCampaignSummary,
  parseCampaignFromLocation,
  readCampaignAttribution,
} from './campaignAttribution.js'

function memoryStorage() {
  const map = new Map()
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null },
    setItem(k, v) { map.set(k, String(v)) },
    removeItem(k) { map.delete(k) },
  }
}

test('parseCampaignFromLocation extracts UTM fields and ?aff= from search or hash queries', () => {
  const fromHash = parseCampaignFromLocation({
    pathname: '/',
    search: '',
    hash: '#/advertise?utm_source=email&utm_medium=resend&utm_campaign=palmetto_bowl&aff=tiger24',
  })
  assert.deepEqual(fromHash, {
    utm_source: 'email',
    utm_medium: 'resend',
    utm_campaign: 'palmetto_bowl',
    aff: 'TIGER24',
    landing_path: 'advertise',
  })

  const fromSearch = parseCampaignFromLocation({
    pathname: '/drive',
    search: '?utm_source=flyer&utm_content=qr_dorm&ref=RIDER99',
    hash: '',
  })
  assert.deepEqual(fromSearch, {
    utm_source: 'flyer',
    utm_content: 'qr_dorm',
    landing_path: 'drive',
  })
  assert.equal(parseCampaignFromLocation({ pathname: '/', search: '?ref=RIDER99', hash: '#/home' }), null)
})

test('captureCampaignAttribution keeps first-touch attribution and forwards ?aff= with the right role', () => {
  const storage = memoryStorage()
  const remembered = []
  const rememberAffiliate = (code, role) => remembered.push({ code, role })

  const first = captureCampaignAttribution({
    location: {
      pathname: '/',
      search: '',
      hash: '#/drive?utm_source=campus_flyer&utm_campaign=nov28_drivers&aff=CLEM77',
    },
    storage,
    rememberAffiliate,
    now: 1000,
  })
  assert.equal(first.first.utm_campaign, 'nov28_drivers')
  assert.equal(first.last.utm_campaign, 'nov28_drivers')
  assert.deepEqual(remembered, [{ code: 'CLEM77', role: 'driver' }])

  // Navigating to a plain page retains first-touch attribution.
  const retained = captureCampaignAttribution({
    location: { pathname: '/', search: '', hash: '#/advertise' },
    storage,
    rememberAffiliate,
    now: 2000,
  })
  assert.equal(retained.first.utm_campaign, 'nov28_drivers')

  // Later campaign link updates last touch without overwriting first touch.
  const second = captureCampaignAttribution({
    location: {
      pathname: '/',
      search: '',
      hash: '#/home?utm_source=instagram&utm_campaign=gsp_holiday&aff=TIGER88',
    },
    storage,
    rememberAffiliate,
    now: 3000,
  })
  assert.equal(second.first.utm_campaign, 'nov28_drivers')
  assert.equal(second.last.utm_campaign, 'gsp_holiday')
  assert.deepEqual(remembered[1], { code: 'TIGER88', role: 'rider' })

  const stored = readCampaignAttribution({ storage })
  assert.equal(
    formatCampaignSummary(stored),
    'utm_source=campus_flyer | utm_campaign=nov28_drivers | aff=CLEM77 | landing=drive',
  )
})

test('adLeadEmail appends sanitized campaign attribution only when provided', () => {
  const row = adLeadRow({
    businessName: 'Tiger Coffee',
    contactName: 'Alex',
    email: 'alex@tiger.test',
    phone: '864-555-0199',
    category: 'Coffee or bakery',
    tier: 'founding-partner',
  })
  const plain = adLeadEmail(row)
  assert.doesNotMatch(plain.text, /Campaign:/)
  const attributed = adLeadEmail(row, 'https://clemsonrides.com', {
    campaign: 'utm_source=smb_email | utm_campaign=founding_partners_nov26\nINJECTED',
  })
  assert.match(attributed.text, /Campaign: utm_source=smb_email \| utm_campaign=founding_partners_nov26 INJECTED/)
})
