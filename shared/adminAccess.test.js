import assert from 'node:assert/strict'
import test from 'node:test'

for (const key of Object.keys(process.env)) {
  if (key.startsWith('STRIPE_') || key.startsWith('SUPABASE_') || key.startsWith('GOOGLE_')) {
    delete process.env[key]
  }
}

const {
  BOT_CONFIDENCE_FLOOR,
  SEEDED_ADMIN_EMAILS,
  TICKET_STATUSES,
  isAdminIdentity,
  isSeedAdminEmail,
  isTicketStatus,
  normalizeEmail,
} = await import('./adminAccess.js')

test('normalizeEmail trims and lowercases', () => {
  assert.equal(normalizeEmail('  JOHN@Gmail.com '), 'john@gmail.com')
  assert.equal(normalizeEmail('\tJohnMatveev@gmail.com\n'), 'johnmatveev@gmail.com')
  assert.equal(normalizeEmail(''), '')
  assert.equal(normalizeEmail('   '), '')
  assert.equal(normalizeEmail(null), '')
  assert.equal(normalizeEmail(undefined), '')
  assert.equal(normalizeEmail('Already@Lower.com'), 'already@lower.com')
})

test('isSeedAdminEmail matches the seeded inboxes only, ignoring case and outer whitespace', () => {
  assert.deepEqual(SEEDED_ADMIN_EMAILS, [
    'johnmatveev@gmail.com',
    'johnmatveyev@gmail.com',
    'jmat2019@icloud.com',
    'john@gmail.com',
  ])
  for (const email of SEEDED_ADMIN_EMAILS) {
    assert.equal(isSeedAdminEmail(email), true, email)
    assert.equal(isSeedAdminEmail(email.toUpperCase()), true, email)
    assert.equal(isSeedAdminEmail(`  ${email}  `), true, email)
  }
  assert.equal(isSeedAdminEmail('student@clemson.edu'), false)
  assert.equal(isSeedAdminEmail('notjohn@gmail.com'), false)
  assert.equal(isSeedAdminEmail('john@gmail.com.evil'), false)
  assert.equal(isSeedAdminEmail('john@gmail.com '), true)
  assert.equal(isSeedAdminEmail(''), false)
  assert.equal(isSeedAdminEmail(null), false)
  assert.equal(isSeedAdminEmail(undefined), false)
})

test('isAdminIdentity combines seed email, isAdmin, and role', () => {
  assert.equal(isAdminIdentity(), false)
  assert.equal(isAdminIdentity(undefined), false)
  assert.equal(isAdminIdentity({}), false)

  assert.equal(isAdminIdentity({ jwtEmail: 'JOHN@gmail.com' }), true)
  assert.equal(isAdminIdentity({ jwtEmail: '  johnmatveev@gmail.com ' }), true)
  assert.equal(isAdminIdentity({ jwtEmail: 'JohnMatveyev@gmail.com' }), true)
  assert.equal(isAdminIdentity({ jwtEmail: '\njmat2019@icloud.com\t' }), true)
  assert.equal(isAdminIdentity({ jwtEmail: 'john@gmail.com', role: 'driver', isAdmin: false }), true)

  assert.equal(isAdminIdentity({ jwtEmail: 'student@clemson.edu', isAdmin: true }), true)
  assert.equal(isAdminIdentity({ isAdmin: true }), true)
  assert.equal(isAdminIdentity({ isAdmin: false }), false)
  assert.equal(isAdminIdentity({ isAdmin: 'true' }), false)
  assert.equal(isAdminIdentity({ isAdmin: 1 }), false)

  assert.equal(isAdminIdentity({ role: 'admin' }), true)
  assert.equal(isAdminIdentity({ role: 'ops' }), true)
  assert.equal(isAdminIdentity({ jwtEmail: 'student@clemson.edu', role: 'admin', isAdmin: false }), true)
  assert.equal(isAdminIdentity({ role: 'ops', isAdmin: false }), true)
  assert.equal(isAdminIdentity({ role: 'Admin' }), false)
  assert.equal(isAdminIdentity({ role: 'OPS' }), false)
  assert.equal(isAdminIdentity({ role: ' admin' }), false)
  assert.equal(isAdminIdentity({ role: 'support' }), false)
  assert.equal(isAdminIdentity({ role: 'driver' }), false)
  assert.equal(isAdminIdentity({ role: 'rider' }), false)
  assert.equal(isAdminIdentity({ role: '' }), false)
  assert.equal(isAdminIdentity({ jwtEmail: 'student@clemson.edu' }), false)
  assert.equal(isAdminIdentity({ jwtEmail: 'student@clemson.edu', role: 'support', isAdmin: false }), false)
  assert.equal(isAdminIdentity({ jwtEmail: '  student@clemson.edu  ', role: 'driver' }), false)
})

test('TICKET_STATUSES and isTicketStatus accept only the exact status strings', () => {
  assert.deepEqual(TICKET_STATUSES, [
    'open',
    'bot_handling',
    'waiting_user',
    'escalated',
    'resolved',
  ])
  for (const status of TICKET_STATUSES) {
    assert.equal(isTicketStatus(status), true, status)
  }
  assert.equal(isTicketStatus('OPEN'), false)
  assert.equal(isTicketStatus('Escalated'), false)
  assert.equal(isTicketStatus('closed'), false)
  assert.equal(isTicketStatus('not_a_status'), false)
  assert.equal(isTicketStatus(' escalated'), false)
  assert.equal(isTicketStatus('escalated '), false)
  assert.equal(isTicketStatus(''), false)
  assert.equal(isTicketStatus(null), false)
  assert.equal(isTicketStatus(undefined), false)
})

test('BOT_CONFIDENCE_FLOOR is 0.75', () => {
  assert.equal(BOT_CONFIDENCE_FLOOR, 0.75)
  assert.equal(typeof BOT_CONFIDENCE_FLOOR, 'number')
})
