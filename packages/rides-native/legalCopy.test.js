import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
  assert.equal(LEGAL_UPDATED, 'October 13, 2026')

  const parsed = Date.parse(LEGAL_UPDATED)
  assert.ok(!Number.isNaN(parsed), 'LEGAL_UPDATED must parse as a valid timestamp')
  const dateObj = new Date(parsed)
  assert.equal(dateObj.getFullYear(), 2026)
  assert.equal(dateObj.getMonth(), 9) // 0-indexed October
  assert.equal(dateObj.getDate(), 13)
})

test('PRIVACY_SECTIONS and TERMS_SECTIONS are frozen against accidental edits', () => {
  assert.equal(Object.isFrozen(PRIVACY_SECTIONS), true)
  assert.equal(Object.isFrozen(TERMS_SECTIONS), true)
  assert.equal(Object.isFrozen(sharedLegal.PRIVACY_SECTIONS), true)
  assert.equal(Object.isFrozen(sharedLegal.TERMS_SECTIONS), true)

  for (const section of [...PRIVACY_SECTIONS, ...TERMS_SECTIONS]) {
    assert.equal(Object.isFrozen(section), true)
    if (section.paragraphs) assert.equal(Object.isFrozen(section.paragraphs), true)
    if (section.bullets) assert.equal(Object.isFrozen(section.bullets), true)
  }

  const privacyHeading = PRIVACY_SECTIONS[0].heading
  assert.throws(() => {
    PRIVACY_SECTIONS.push({ heading: 'Extra' })
  }, TypeError)
  assert.throws(() => {
    PRIVACY_SECTIONS[0].heading = 'Changed'
  }, TypeError)
  assert.equal(PRIVACY_SECTIONS[0].heading, privacyHeading)
  assert.equal(PRIVACY_SECTIONS.length, 12)
})

test('PRIVACY_SECTIONS conforms to required structure and unique headings', () => {
  assert.ok(Array.isArray(PRIVACY_SECTIONS))
  assert.equal(PRIVACY_SECTIONS.length, 12)

  const expectedHeadings = [
    'Article 1. Who We Are',
    'Article 2. Definitions',
    'Article 3. Information We Collect',
    'Article 4. How We Use Information',
    'Article 5. Sharing',
    'Article 6. Recordings',
    'Article 7. Names and Phone Numbers',
    'Article 8. Retention and Security',
    'Article 9. Your Rights and Choices',
    'Article 10. Children',
    'Article 11. No Duty from This Policy',
    'Article 12. Contact',
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
  const whoWeAre = PRIVACY_SECTIONS.find((s) => s.heading === 'Article 1. Who We Are')
  assert.ok(whoWeAre)
  assert.match(whoWeAre.paragraphs[0], /Clemson RIDES/)
  assert.match(whoWeAre.paragraphs[0], /GSP\/CLT/)

  const infoCollect = PRIVACY_SECTIONS.find((s) => s.heading === 'Article 3. Information We Collect')
  assert.ok(infoCollect)
  assert.ok(infoCollect.bullets.some((b) => b.includes('Supabase Auth')))
  assert.ok(infoCollect.bullets.some((b) => b.includes('@clemson.edu')))
  assert.ok(infoCollect.bullets.some((b) => b.includes('student_verified_at')))
  assert.ok(infoCollect.bullets.some((b) => b.includes('Stripe Checkout')))

  const howWeUse = PRIVACY_SECTIONS.find((s) => s.heading === 'Article 4. How We Use Information')
  assert.ok(howWeUse)
  assert.match(howWeUse.paragraphs[0], /We do not sell your personal information\./)

  const choices = PRIVACY_SECTIONS.find((s) => s.heading === 'Article 9. Your Rights and Choices')
  assert.ok(choices)
  assert.match(choices.paragraphs[0], /Account/)
  assert.match(choices.paragraphs[0], /request deletion/)

  const children = PRIVACY_SECTIONS.find((s) => s.heading === 'Article 10. Children')
  assert.ok(children)
  assert.match(children.paragraphs[0], /under 13/)
  assert.match(children.paragraphs[0], /under 18/)
})

test('TERMS_SECTIONS conforms to required structure and unique headings', () => {
  assert.ok(Array.isArray(TERMS_SECTIONS))
  assert.equal(TERMS_SECTIONS.length, 23)

  const expectedHeadings = [
    'Article 1. Agreement',
    'Article 2. Definitions',
    'Article 3. Eligibility',
    'Article 4. The Services',
    'Article 5. Rider Responsibilities',
    'Article 6. Driver Responsibilities',
    'Article 7. Payments & earnings',
    'Article 8. Technology Platform',
    'Article 9. Independent Contractors',
    'Article 10. Driver Agreement',
    'Article 11. South Carolina TNC Compliance',
    'Article 12. Assumption of Risk',
    'Article 13. Disclaimers',
    'Article 14. Limitation of Liability',
    'Article 15. Release and Waiver',
    'Article 16. Indemnification and Defense',
    'Article 17. Safety Cooperation',
    'Article 18. Dispute Resolution',
    'Article 19. Governing Law and Venue',
    'Article 20. General Provisions',
    'Article 21. Termination',
    'Article 22. Changes',
    'Article 23. Notices and Contact',
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
  const service = TERMS_SECTIONS.find((s) => s.heading === 'Article 4. The Services')
  assert.ok(service)
  assert.match(service.paragraphs[0], /card hold for the estimated fare plus a buffer/)
  assert.match(service.paragraphs[0], /GSP and CLT/)

  const riderResp = TERMS_SECTIONS.find((s) => s.heading === 'Article 5. Rider Responsibilities')
  assert.ok(riderResp)
  assert.equal(riderResp.paragraphs, undefined)
  assert.equal(riderResp.bullets.length, 4)

  const driverResp = TERMS_SECTIONS.find((s) => s.heading === 'Article 6. Driver Responsibilities')
  assert.ok(driverResp)
  assert.equal(driverResp.paragraphs, undefined)
  assert.equal(driverResp.bullets.length, 3)
  assert.ok(driverResp.bullets.some((b) => b.includes('3-minute grace')))

  const payments = TERMS_SECTIONS.find((s) => s.heading === 'Article 7. Payments & earnings')
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

  const disclaimers = TERMS_SECTIONS.find((s) => s.heading === 'Article 13. Disclaimers')
  assert.ok(disclaimers)
  assert.match(disclaimers.paragraphs[0], /independent drivers/)
  assert.match(disclaimers.paragraphs[0], /not a common carrier/)
  assert.match(disclaimers.paragraphs.join(' '), /AS IS/)
})

test('terms limit liability and privacy states the platform data limits', () => {
  const termsText = TERMS_SECTIONS.flatMap((section) => [
    section.heading,
    ...(section.paragraphs || []),
    ...(section.bullets || []),
  ]).join('\n')
  const privacyText = PRIVACY_SECTIONS.flatMap((section) => [
    section.heading,
    ...(section.paragraphs || []),
    ...(section.bullets || []),
  ]).join('\n')

  assert.match(termsText, /technology platform/)
  assert.match(termsText, /not a transportation carrier/)
  assert.match(termsText, /does not provide transportation services/)
  assert.match(termsText, /independent contractors/)
  assert.match(termsText, /not employees, agents/)
  assert.match(termsText, /at your own risk and by your own choice/)
  assert.match(termsText, /SOS/)
  assert.match(termsText, /call 911/)
  assert.match(termsText, /trip sharing/)
  assert.match(termsText, /safety numbers/)
  assert.match(termsText, /sexual misconduct/)
  assert.match(termsText, /consequential/)
  assert.match(termsText, /punitive damages/)
  assert.match(termsText, /US\$100/)
  assert.match(termsText, /indemnify/)
  assert.match(termsText, /release and forever discharge/)
  assert.match(termsText, /binding individual arbitration/)
  assert.match(termsText, /class-action waiver/)
  assert.match(termsText, /small-claims carve-out/)
  assert.match(termsText, /sole discretion/)
  assert.match(termsText, /do not create a duty of care/)
  assert.match(termsText, /to the maximum extent permitted by applicable law/)
  assert.match(termsText, /gross negligence or willful misconduct/)
  assert.match(termsText, /severability/)
  assert.match(termsText, /South Carolina/)
  assert.match(termsText, /101 North Main Street, Greenville, SC 29601/)
  assert.match(termsText, /no employment, no agency, and no partnership/)
  assert.match(termsText, /solely responsible/)
  assert.match(termsText, /forfeiture of incentives/)
  assert.match(termsText, /at its sole discretion/)
  assert.match(termsText, /shall never be held liable, to the fullest extent permitted by law/)
  assert.match(termsText, /indemnifies and defends the platform/)
  assert.match(termsText, /S\.C\. Code Ann\. Title 58, Chapter 23, Article 16/)
  assert.match(termsText, /58-23-1610/)
  assert.match(termsText, /Zero-Tolerance Policy/)
  assert.match(termsText, /service animals/i)
  assert.match(termsText, /national sex-offender registry/)
  assert.match(termsText, /one million dollars/)
  assert.match(termsText, /Federal Arbitration Act/)
  assert.match(termsText, /collective action/i)
  assert.match(termsText, /thirty \(30\) days/)
  assert.match(termsText, /Consumer Arbitration Rules/)
  assert.match(termsText, /batches of 25/)
  assert.match(termsText, /delegation clause/)
  assert.match(termsText, /WAIVE ANY RIGHT TO A TRIAL BY JURY/)
  assert.match(termsText, /blue pencil/)
  assert.match(termsText, /Section 20\.2\. Survival/)
  assert.match(termsText, /Section 20\.3\. Entire agreement/)
  assert.match(termsText, /Section 20\.4\. No waiver/)
  assert.match(termsText, /Section 20\.5\. Assignment/)
  assert.match(termsText, /Section 20\.6\. Force majeure/)
  assert.match(termsText, /15 U\.S\.C\. § 7001/)
  assert.match(termsText, /electronic signature/)
  for (const heading of [
    'Article 12. Assumption of Risk',
    'Article 13. Disclaimers',
    'Article 14. Limitation of Liability',
    'Article 15. Release and Waiver',
  ]) {
    const section = TERMS_SECTIONS.find((item) => item.heading === heading)
    const body = (section?.paragraphs || []).join('\n')
    assert.match(body, /to the fullest extent permitted by law/i)
    assert.match(body, /motor vehicle accidents, collisions, and crashes/i)
    assert.match(body, /bodily injury, death, or property damage/i)
    assert.match(body, /before, during, or after any Ride/i)
  }
  assert.match(termsText, /Accident claims shall be directed to the applicable Driver/)
  assert.match(termsText, /the Driver and the Driver’s automobile insurance carrier\(s\) are solely responsible for any accidents and all resulting liability, including injuries, death, and property damage/)
  const driverAgreement = TERMS_SECTIONS.find((section) => section.heading === 'Article 10. Driver Agreement')
  const driverAgreementText = (driverAgreement?.paragraphs || []).join('\n')
  assert.match(driverAgreementText, /automobile insurance carrier\(s\) are solely responsible for any accidents/)
  assert.match(driverAgreementText, /fifty thousand dollars for death and bodily injury per person/)
  assert.match(driverAgreementText, /one million dollars for death, bodily injury, and property damage/)
  assert.match(driverAgreementText, /standard commercial general liability policy for its own business operations/)
  assert.match(driverAgreementText, /does not extend to or cover, any Ride, Driver, or Rider incident, accident, injury, or interaction, except as otherwise required by applicable law/)
  assert.match(termsText, /standard commercial general liability policy for its own business operations/)
  assert.match(readFileSync(new URL('../../shared/legalCopy.js', import.meta.url), 'utf8'), /ATTORNEY CONFIRMATION: S\.C\. Code Ann\. § 58-23-1630\(D\)/)
  assert.match(termsText, /statutorily required TNC insurance coverage, not to the Company/)
  assert.match(termsText, /report an accident promptly through the app/)
  assert.match(privacyText, /under 18/)
  assert.match(privacyText, /state privacy law/)

  assert.match(privacyText, /not a transportation carrier/)
  assert.match(privacyText, /does not provide transportation services/)
  assert.match(privacyText, /independent contractors/)
  assert.match(privacyText, /safety reports/)
  assert.match(privacyText, /law enforcement/)
  assert.match(privacyText, /keep those recordings local/)
  assert.match(privacyText, /stored on the driver’s device/)
  assert.match(privacyText, /dashcam/)
  assert.match(privacyText, /first name only/)
  assert.match(privacyText, /Phone numbers are never shared between riders and drivers/)
  assert.match(privacyText, /to the maximum extent permitted by applicable law/)
  assert.match(privacyText, /gross negligence or willful misconduct/)
  assert.match(privacyText, /101 North Main Street, Greenville, SC 29601/)
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
      meta: `Clemson Rides · Last updated ${LEGAL_UPDATED}`,
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
  assert.equal(nativePrivacy.renderedSections.length, 12)

  const nativeTerms = renderNativeScreen('terms')
  assert.equal(nativeTerms.title, 'Terms of Service')
  assert.equal(nativeTerms.renderedSections.length, 23)

  // Emulate rendering logic from src/screens/LegalPages.jsx
  const renderWebBody = (sections) => {
    return sections.map((section) => {
      const pItems = section.paragraphs ? section.paragraphs.map((p) => p.slice(0, 48)) : null
      const bItems = section.bullets ? section.bullets.map((b) => b.slice(0, 48)) : null
      return { heading: section.heading, pItems, bItems }
    })
  }

  const webPrivacy = renderWebBody(PRIVACY_SECTIONS)
  assert.equal(webPrivacy.length, 12)
  const webTerms = renderWebBody(TERMS_SECTIONS)
  assert.equal(webTerms.length, 23)
})
