import assert from 'node:assert/strict'
import test from 'node:test'
import * as nativeLegal from './legalCopy.js'
import {
  LEGAL_UPDATED,
  PRIVACY_SECTIONS,
  TERMS_SECTIONS,
} from './legalCopy.js'
import * as sharedLegal from '../../shared/legalCopy.js'

test('legalCopy exports match shared legal copy module exactly', () => {
  // BUG?: legalCopy.js does not provide a default export, only named exports
  assert.equal(nativeLegal.default, undefined)

  // Verify that native re-exports point to the exact same references as shared/legalCopy.js
  assert.equal(nativeLegal.LEGAL_UPDATED, sharedLegal.LEGAL_UPDATED)
  assert.equal(nativeLegal.PRIVACY_SECTIONS, sharedLegal.PRIVACY_SECTIONS)
  assert.equal(nativeLegal.TERMS_SECTIONS, sharedLegal.TERMS_SECTIONS)

  // BUG?: legalCopy exports only static data; no helper functions (e.g. section lookup, formatting) are exported
  const exportedKeys = Object.keys(nativeLegal).sort()
  assert.deepEqual(exportedKeys, ['LEGAL_UPDATED', 'PRIVACY_SECTIONS', 'TERMS_SECTIONS'])
  for (const key of exportedKeys) {
    assert.notEqual(typeof nativeLegal[key], 'function')
  }
})

test('LEGAL_UPDATED date string is well-formed and parseable', () => {
  // BUG?: LEGAL_UPDATED is formatted as human-readable text rather than ISO-8601 (YYYY-MM-DD)
  assert.equal(typeof LEGAL_UPDATED, 'string')
  assert.equal(LEGAL_UPDATED, 'September 22, 2026')

  const parsed = Date.parse(LEGAL_UPDATED)
  assert.ok(!Number.isNaN(parsed), 'LEGAL_UPDATED must parse as a valid timestamp')
  const dateObj = new Date(parsed)
  assert.equal(dateObj.getFullYear(), 2026)
  assert.equal(dateObj.getMonth(), 8) // 0-indexed September
  assert.equal(dateObj.getDate(), 22)
})

test('PRIVACY_SECTIONS and TERMS_SECTIONS arrays and objects are mutable (unfrozen)', () => {
  // BUG?: PRIVACY_SECTIONS and TERMS_SECTIONS are not frozen with Object.freeze(), allowing callers to inadvertently mutate shared legal copy
  assert.equal(Object.isFrozen(PRIVACY_SECTIONS), false)
  assert.equal(Object.isFrozen(TERMS_SECTIONS), false)

  // BUG?: Individual section objects and arrays within PRIVACY_SECTIONS and TERMS_SECTIONS are also unfrozen
  for (const section of PRIVACY_SECTIONS) {
    assert.equal(Object.isFrozen(section), false)
    if (section.paragraphs) assert.equal(Object.isFrozen(section.paragraphs), false)
    if (section.bullets) assert.equal(Object.isFrozen(section.bullets), false)
  }
  for (const section of TERMS_SECTIONS) {
    assert.equal(Object.isFrozen(section), false)
    if (section.paragraphs) assert.equal(Object.isFrozen(section.paragraphs), false)
    if (section.bullets) assert.equal(Object.isFrozen(section.bullets), false)
  }
})

test('PRIVACY_SECTIONS conforms to required structure and unique headings', () => {
  assert.ok(Array.isArray(PRIVACY_SECTIONS))
  assert.equal(PRIVACY_SECTIONS.length, 7)

  const expectedHeadings = [
    'Who we are',
    'Information we collect',
    'How we use information',
    'Sharing',
    'Retention & security',
    'Your choices',
    'Children',
  ]

  const headings = PRIVACY_SECTIONS.map((s) => s.heading)
  assert.deepEqual(headings, expectedHeadings)

  // Unique headings are required because React components use `key={section.heading}`
  const uniqueHeadings = new Set(headings)
  assert.equal(uniqueHeadings.size, PRIVACY_SECTIONS.length)

  for (const section of PRIVACY_SECTIONS) {
    assert.equal(typeof section.heading, 'string')
    assert.ok(section.heading.trim().length > 0)

    const hasParagraphs = Array.isArray(section.paragraphs) && section.paragraphs.length > 0
    const hasBullets = Array.isArray(section.bullets) && section.bullets.length > 0
    assert.ok(hasParagraphs || hasBullets, `Section "${section.heading}" has neither paragraphs nor bullets`)

    if (section.paragraphs) {
      for (const p of section.paragraphs) {
        assert.equal(typeof p, 'string')
        assert.ok(p.trim().length > 0)
      }
      // Check paragraph key collision with slice(0, 48) as used in UI rendering
      const pKeys = section.paragraphs.map((p) => p.slice(0, 48))
      assert.equal(new Set(pKeys).size, section.paragraphs.length)
    } else {
      // BUG?: sections without paragraphs omit the field entirely rather than providing an empty array
      assert.equal(section.paragraphs, undefined)
    }

    if (section.bullets) {
      for (const b of section.bullets) {
        assert.equal(typeof b, 'string')
        assert.ok(b.trim().length > 0)
      }
      // Check bullet key collision with slice(0, 48) as used in UI rendering
      const bKeys = section.bullets.map((b) => b.slice(0, 48))
      assert.equal(new Set(bKeys).size, section.bullets.length)
    } else {
      // BUG?: sections without bullets omit the field entirely rather than providing an empty array
      assert.equal(section.bullets, undefined)
    }
  }
})

test('PRIVACY_SECTIONS contains critical compliance and campus policy statements', () => {
  const whoWeAre = PRIVACY_SECTIONS.find((s) => s.heading === 'Who we are')
  assert.ok(whoWeAre)
  assert.match(whoWeAre.paragraphs[0], /Clemson RIDES/)
  assert.match(whoWeAre.paragraphs[0], /GSP\/CLT/)

  const infoCollect = PRIVACY_SECTIONS.find((s) => s.heading === 'Information we collect')
  assert.ok(infoCollect)
  assert.ok(infoCollect.bullets.some((b) => b.includes('Supabase Auth')))
  assert.ok(infoCollect.bullets.some((b) => b.includes('@clemson.edu')))
  assert.ok(infoCollect.bullets.some((b) => b.includes('student_verified_at')))
  assert.ok(infoCollect.bullets.some((b) => b.includes('Stripe Checkout')))

  const howWeUse = PRIVACY_SECTIONS.find((s) => s.heading === 'How we use information')
  assert.ok(howWeUse)
  assert.match(howWeUse.paragraphs[0], /We do not sell your personal information\./)

  const choices = PRIVACY_SECTIONS.find((s) => s.heading === 'Your choices')
  assert.ok(choices)
  assert.match(choices.paragraphs[0], /Account/)
  assert.match(choices.paragraphs[0], /request deletion/)

  const children = PRIVACY_SECTIONS.find((s) => s.heading === 'Children')
  assert.ok(children)
  assert.match(children.paragraphs[0], /under 13/)
})

test('TERMS_SECTIONS conforms to required structure and unique headings', () => {
  assert.ok(Array.isArray(TERMS_SECTIONS))
  assert.equal(TERMS_SECTIONS.length, 10)

  const expectedHeadings = [
    'Agreement',
    'Eligibility',
    'The service',
    'Rider responsibilities',
    'Driver responsibilities',
    'Payments & earnings',
    'Disclaimers',
    'Termination',
    'Changes',
    'Contact',
  ]

  const headings = TERMS_SECTIONS.map((s) => s.heading)
  assert.deepEqual(headings, expectedHeadings)

  // Unique headings required for React keys
  assert.equal(new Set(headings).size, TERMS_SECTIONS.length)

  for (const section of TERMS_SECTIONS) {
    assert.equal(typeof section.heading, 'string')
    assert.ok(section.heading.trim().length > 0)

    const hasParagraphs = Array.isArray(section.paragraphs) && section.paragraphs.length > 0
    const hasBullets = Array.isArray(section.bullets) && section.bullets.length > 0
    assert.ok(hasParagraphs || hasBullets, `Section "${section.heading}" has neither paragraphs nor bullets`)

    if (section.paragraphs) {
      for (const p of section.paragraphs) {
        assert.equal(typeof p, 'string')
        assert.ok(p.trim().length > 0)
      }
      const pKeys = section.paragraphs.map((p) => p.slice(0, 48))
      assert.equal(new Set(pKeys).size, section.paragraphs.length)
    } else {
      // BUG?: 'Rider responsibilities' and 'Driver responsibilities' have undefined paragraphs, requiring optional chaining in renderers
      assert.equal(section.paragraphs, undefined)
    }

    if (section.bullets) {
      for (const b of section.bullets) {
        assert.equal(typeof b, 'string')
        assert.ok(b.trim().length > 0)
      }
      const bKeys = section.bullets.map((b) => b.slice(0, 48))
      assert.equal(new Set(bKeys).size, section.bullets.length)
    } else {
      // BUG?: sections without bullets have undefined bullets property rather than empty array
      assert.equal(section.bullets, undefined)
    }
  }
})

test('TERMS_SECTIONS contains core financial, operational, and fee rules', () => {
  const service = TERMS_SECTIONS.find((s) => s.heading === 'The service')
  assert.ok(service)
  assert.match(service.paragraphs[0], /25% deposit via Stripe/)
  assert.match(service.paragraphs[0], /GSP and CLT/)

  const riderResp = TERMS_SECTIONS.find((s) => s.heading === 'Rider responsibilities')
  assert.ok(riderResp)
  assert.equal(riderResp.paragraphs, undefined)
  assert.equal(riderResp.bullets.length, 4)

  const driverResp = TERMS_SECTIONS.find((s) => s.heading === 'Driver responsibilities')
  assert.ok(driverResp)
  assert.equal(driverResp.paragraphs, undefined)
  assert.equal(driverResp.bullets.length, 3)
  assert.ok(driverResp.bullets.some((b) => b.includes('3-minute grace')))

  const payments = TERMS_SECTIONS.find((s) => s.heading === 'Payments & earnings')
  assert.ok(payments)
  const paymentsText = payments.paragraphs[0]
  // 20/80 revenue split
  assert.match(paymentsText, /20% of rider charges/)
  assert.match(paymentsText, /driver keeps 80%/)
  // Wait fee schedule
  assert.match(paymentsText, /3-minute grace at \$0/)
  assert.match(paymentsText, /\$1 per minute \(rounded up\)/)
  // Cancellation timeline
  assert.match(paymentsText, /From 5 minutes the driver may cancel/)
  assert.match(paymentsText, /At 7 minutes the ride cancels automatically/)
  assert.match(paymentsText, /charged \$5 \(\$4 wait \+ \$1 cancellation fee\)/)
  assert.match(paymentsText, /driver keeps \$4, and the platform keeps \$1/)

  const disclaimers = TERMS_SECTIONS.find((s) => s.heading === 'Disclaimers')
  assert.ok(disclaimers)
  assert.match(disclaimers.paragraphs[0], /independent drivers/)
  assert.match(disclaimers.paragraphs[0], /not a common carrier/)
})

test('legalCopy content has no placeholder tokens or corrupted text', () => {
  const allSections = [...PRIVACY_SECTIONS, ...TERMS_SECTIONS]
  for (const section of allSections) {
    const textPieces = [
      section.heading,
      ...(section.paragraphs || []),
      ...(section.bullets || []),
    ]
    for (const text of textPieces) {
      assert.ok(!text.includes('TODO'), `Found TODO placeholder in "${text}"`)
      assert.ok(!text.includes('TBD'), `Found TBD placeholder in "${text}"`)
      assert.ok(!text.includes('undefined'), `Found literal "undefined" in "${text}"`)
      assert.ok(!text.includes('null'), `Found literal "null" in "${text}"`)
      assert.ok(!text.includes('[object Object]'), `Found stringified object in "${text}"`)
      assert.ok(!text.includes('lorem ipsum'), `Found placeholder lorem ipsum in "${text}"`)
    }
  }
})

test('simulated app rendering matches rider and web consumer logic', () => {
  // Emulate rendering logic from apps/rider/app/legal.tsx
  const renderNativeScreen = (doc) => {
    const sections = doc === 'terms' ? TERMS_SECTIONS : PRIVACY_SECTIONS
    const title = doc === 'terms' ? 'Terms of Service' : 'Privacy Policy'
    const rendered = {
      title,
      meta: `Clemson RIDES · Last updated ${LEGAL_UPDATED}`,
      renderedSections: sections.map((section) => ({
        heading: section.heading,
        paragraphCount: section.paragraphs?.length ?? 0,
        bulletCount: section.bullets?.length ?? 0,
      })),
    }
    return rendered
  }

  const nativePrivacy = renderNativeScreen('privacy')
  assert.equal(nativePrivacy.title, 'Privacy Policy')
  assert.equal(nativePrivacy.renderedSections.length, 7)

  const nativeTerms = renderNativeScreen('terms')
  assert.equal(nativeTerms.title, 'Terms of Service')
  assert.equal(nativeTerms.renderedSections.length, 10)

  // Emulate rendering logic from src/screens/LegalPages.jsx
  const renderWebBody = (sections) => {
    return sections.map((section) => {
      const pItems = section.paragraphs ? section.paragraphs.map((p) => p.slice(0, 48)) : null
      const bItems = section.bullets ? section.bullets.map((b) => b.slice(0, 48)) : null
      return { heading: section.heading, pItems, bItems }
    })
  }

  const webPrivacy = renderWebBody(PRIVACY_SECTIONS)
  assert.equal(webPrivacy.length, 7)
  const webTerms = renderWebBody(TERMS_SECTIONS)
  assert.equal(webTerms.length, 10)
})
