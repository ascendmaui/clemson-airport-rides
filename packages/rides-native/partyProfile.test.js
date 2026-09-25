import assert from 'node:assert/strict'
import test from 'node:test'
import * as partyProfile from './partyProfile.js'
import {
  PARTY_VISIBLE_STATUSES,
  PROFILE_FIELD_LABELS,
  RIDE_STYLES,
  SIGNUP_PROFILE_DRAFT_KEY,
  asSpotList,
  buildEnsureProfilePatch,
  counterpartId,
  digits,
  fetchTripForRating,
  findPendingRating,
  formatPhone,
  formatRatingLine,
  hasRatedTrip,
  hasRideStyle,
  isProfileComplete,
  loadCounterpart,
  loadOwnProfile,
  loadPublicProfile,
  missingProfileFields,
  profileFieldError,
  profileRowFromUser,
  ratingBlockReason,
  readSignupDraft,
  saveOwnProfile,
  shouldLeaveProfileSetup,
  shouldRedirectToProfileSetup,
  signupProfileMetadata,
  submitPartyRating,
  toCounterpartView,
  userWithDraft,
  validateStars,
} from './partyProfile.js'

const complete = {
  full_name: 'Jordan Lee',
  phone: '(864) 555-1212',
  bio: 'Quiet rides to GSP.',
  ride_style: 'Quiet',
}

test('signup profile requires name, phone, bio, and ride style', () => {
  assert.deepEqual(missingProfileFields({}), ['full_name', 'phone', 'bio', 'ride_style'])
  assert.equal(isProfileComplete(complete), true)
  assert.equal(isProfileComplete({ ...complete, ride_style: 'Chatty | Music on' }), true)
  assert.match(profileFieldError({ ...complete, bio: 'short' }), /short bio/)
  assert.equal(profileFieldError(complete), null)
})

test('signup metadata keeps a promo and normalizes the phone', () => {
  const meta = signupProfileMetadata({
    fullName: 'Jordan Lee',
    phone: '864-555-1212',
    bio: 'Quiet rides to GSP.',
    rideStyle: 'Quiet',
    promoCode: 'tiger-1',
  })
  assert.equal(meta.full_name, 'Jordan Lee')
  assert.equal(meta.phone, '8645551212')
  assert.equal(meta.ride_style, 'Quiet')
  assert.equal(meta.promo_code, 'TIGER1')
  assert.equal(profileRowFromUser({ user_metadata: { bio: 'nope' } }).bio, undefined)
})

test('ensure profile fills blanks and does not clobber an edited profile', () => {
  const user = {
    id: 'user-1',
    email: 'jordan@clemson.edu',
    user_metadata: {
      full_name: 'Jordan Lee',
      phone: '8645551212',
      bio: 'From signup.',
      ride_style: 'Quiet',
    },
  }
  const created = buildEnsureProfilePatch(null, user, '2026-09-24T00:00:00.000Z', true)
  assert.equal(created.full_name, 'Jordan Lee')
  assert.equal(created.phone, '8645551212')
  assert.equal(created.bio, 'From signup.')
  assert.equal(created.student_verified_at, '2026-09-24T00:00:00.000Z')

  const edited = buildEnsureProfilePatch({
    id: 'user-1',
    full_name: 'Jordan L.',
    phone: '8645559999',
    bio: 'Edited bio here.',
    ride_style: 'Chatty',
    student_verified_at: '2026-01-01T00:00:00.000Z',
  }, user, '2026-09-24T00:00:00.000Z', true)
  assert.equal(edited.full_name, undefined)
  assert.equal(edited.phone, undefined)
  assert.equal(edited.bio, undefined)
  assert.equal(edited.ride_style, undefined)
  assert.equal(edited.student_verified_at, undefined)
})

test('a stored signup draft fills social metadata once', () => {
  const draft = readSignupDraft(JSON.stringify({
    fullName: 'Avery Chen',
    phone: '8645550100',
    bio: 'Music on the way.',
    rideStyle: 'Music on',
    promo: 'pal',
  }))
  assert.equal(readSignupDraft('not-json'), null)
  const user = userWithDraft({ id: 'u', user_metadata: { name: 'Avery Chen' } }, draft)
  assert.equal(user.user_metadata.bio, 'Music on the way.')
  assert.equal(user.user_metadata.ride_style, 'Music on')
})

test('profile setup stays in front of the app until the profile is complete', () => {
  assert.equal(shouldRedirectToProfileSetup({ signedIn: true, complete: false, segment: '(tabs)' }), true)
  assert.equal(shouldRedirectToProfileSetup({ signedIn: true, complete: false, segment: 'sign-in' }), false)
  assert.equal(shouldRedirectToProfileSetup({ signedIn: true, complete: false, segment: 'auth' }), false)
  assert.equal(shouldRedirectToProfileSetup({ signedIn: true, complete: false, segment: 'profile-setup' }), false)
  assert.equal(shouldRedirectToProfileSetup({ signedIn: false, complete: false, segment: '(tabs)' }), false)
  assert.equal(shouldRedirectToProfileSetup({ signedIn: true, complete: true, segment: 'trip' }), false)
  assert.equal(shouldLeaveProfileSetup({ signedIn: true, complete: true, segment: 'profile-setup' }), true)
  assert.equal(shouldLeaveProfileSetup({ signedIn: true, complete: false, segment: 'profile-setup' }), false)
})

test('counterpart profiles show only after a ride is accepted', () => {
  const trip = { status: 'accepted', rider_id: 'rider', driver_id: 'driver' }
  assert.equal(counterpartId(trip, 'rider'), 'driver')
  assert.equal(counterpartId(trip, 'driver'), 'rider')
  assert.equal(counterpartId({ ...trip, status: 'searching', driver_id: null }, 'rider'), null)
  assert.equal(counterpartId({ ...trip, status: 'offered' }, 'rider'), null)
  assert.equal(counterpartId({ ...trip, status: 'canceled' }, 'rider'), null)
  assert.equal(counterpartId({ ...trip, rider_id: 'driver', driver_id: 'driver' }, 'driver'), null)
})

test('mutual ratings are 1–5 stars after the trip is completed', () => {
  const trip = { status: 'completed', rider_id: 'rider', driver_id: 'driver' }
  assert.equal(ratingBlockReason(trip, 'rider'), null)
  assert.equal(ratingBlockReason(trip, 'driver'), null)
  assert.match(ratingBlockReason({ ...trip, status: 'in_progress' }, 'rider'), /not completed/)
  assert.match(ratingBlockReason(trip, 'stranger'), /Only the rider or driver/)
  assert.equal(ratingBlockReason({ ...trip, rider_id: 'driver' }, 'driver'), 'Cannot rate yourself')
  assert.equal(validateStars(5), null)
  assert.equal(validateStars(1), null)
  assert.match(validateStars(0), /1–5/)
  assert.match(validateStars(3.5), /1–5/)
})

test('profile aggregates format the stored average', () => {
  assert.equal(formatRatingLine(4.833, 12), '4.8 · 12 ratings')
  assert.equal(formatRatingLine(5, 1), '5.0 · 1 rating')
  assert.equal(formatRatingLine(null, 0), 'New · no ratings yet')
  const view = toCounterpartView({
    id: 'driver',
    full_name: 'Sam Okonkwo',
    rating_avg: 4.9,
    rating_count: 8,
    bio: 'Campus to CLT.',
    ride_style: 'Chatty',
    favorite_spots: ['Cooper Library'],
    phone: '8645551212',
    student_verified_at: '2026-01-01',
    vehicle: { color: 'White', make: 'Tesla', model: 'Model 3' },
  }, { viewerIsRider: true })
  assert.equal(view.name, 'Sam')
  assert.equal(view.ratingLine, '4.9 · 8 ratings')
  assert.equal(view.vehicle, 'White Tesla Model 3')
  assert.equal(view.roleLabel, 'Your driver')
  assert.equal(view.student, true)
  assert.equal(view.phone, '(864) 555-1212')
})

const EXPORTED_HELPERS = [
  'SIGNUP_PROFILE_DRAFT_KEY',
  'RIDE_STYLES',
  'PARTY_VISIBLE_STATUSES',
  'PROFILE_FIELD_LABELS',
  'digits',
  'formatPhone',
  'hasRideStyle',
  'missingProfileFields',
  'isProfileComplete',
  'profileFieldError',
  'profileRowFromUser',
  'signupProfileMetadata',
  'readSignupDraft',
  'userWithDraft',
  'buildEnsureProfilePatch',
  'shouldRedirectToProfileSetup',
  'shouldLeaveProfileSetup',
  'counterpartId',
  'ratingBlockReason',
  'validateStars',
  'formatRatingLine',
  'asSpotList',
  'vehicleLabelFromRow',
  'toCounterpartView',
  'loadOwnProfile',
  'loadPublicProfile',
  'saveOwnProfile',
  'loadCounterpart',
  'fetchTripForRating',
  'hasRatedTrip',
  'submitPartyRating',
  'findPendingRating',
]

test('the module exports every profile and rating helper', () => {
  assert.deepEqual(Object.keys(partyProfile).sort(), [...EXPORTED_HELPERS].sort())
  for (const name of EXPORTED_HELPERS) {
    assert.notEqual(partyProfile[name], undefined, name)
  }
  assert.equal(SIGNUP_PROFILE_DRAFT_KEY, 'clemson_signup_profile_draft')
  assert.deepEqual(RIDE_STYLES, ['Quiet', 'Chatty', 'Music on', 'AC max'])
  assert.deepEqual(PARTY_VISIBLE_STATUSES, ['accepted', 'arriving', 'arrived', 'in_progress', 'completed'])
  assert.deepEqual(PROFILE_FIELD_LABELS, {
    full_name: 'full name',
    phone: 'mobile number',
    bio: 'short bio',
    ride_style: 'ride style',
  })
})

test('digits and formatPhone keep a 10-digit mobile and a leading-1 number', () => {
  assert.equal(digits(null), '')
  assert.equal(digits(undefined), '')
  assert.equal(digits('+1 (864) 555-1212'), '18645551212')
  assert.equal(digits(8645551212), '8645551212')
  assert.equal(formatPhone('8645551212'), '(864) 555-1212')
  assert.equal(formatPhone('  864 555 1212  '), '(864) 555-1212')
  assert.equal(formatPhone('18645551212'), '+1 (864) 555-1212')
  assert.equal(formatPhone(''), '')
  assert.equal(formatPhone(null), '')
  assert.equal(formatPhone('555'), '555')
  assert.equal(formatPhone('28645551212'), '28645551212')
  assert.equal(formatPhone('+44 20 7946 0958'), '+44 20 7946 0958')
  // BUG?: numeric values are stringified first, so 1e21 becomes "1e+21" and only "121" remains.
  assert.equal(digits(1e21), '121')
})

test('ride style matches a known token, including a pipe-joined list', () => {
  for (const style of RIDE_STYLES) assert.equal(hasRideStyle(style), true)
  assert.equal(hasRideStyle(' Quiet | nope '), true)
  assert.equal(hasRideStyle('Chatty | Music on'), true)
  assert.equal(hasRideStyle('Quiet|Chatty'), true)
  assert.equal(hasRideStyle(''), false)
  assert.equal(hasRideStyle(null), false)
  assert.equal(hasRideStyle('|'), false)
  assert.equal(hasRideStyle('Loud'), false)
  assert.equal(hasRideStyle('quiet'), false)
  assert.equal(hasRideStyle('Music  on'), false)
})

test('profile fields fail closed on short name, phone, and bio', () => {
  assert.deepEqual(missingProfileFields(null), ['full_name', 'phone', 'bio', 'ride_style'])
  assert.deepEqual(
    missingProfileFields({ full_name: ' J ', phone: '8645551212', bio: 'long enough bio', ride_style: 'Quiet' }),
    ['full_name'],
  )
  assert.deepEqual(
    missingProfileFields({ full_name: 'Jo', phone: '864555121', bio: 'long enough bio', ride_style: 'Quiet' }),
    ['phone'],
  )
  assert.deepEqual(
    missingProfileFields({ full_name: 'Jo', phone: '8645551212', bio: '1234567', ride_style: 'Quiet' }),
    ['bio'],
  )
  assert.deepEqual(
    missingProfileFields({ full_name: 'Jo', phone: '8645551212', bio: '        ', ride_style: 'Quiet' }),
    ['bio'],
  )
  assert.deepEqual(
    missingProfileFields({ full_name: 'Jo', phone: '8645551212', bio: '12345678', ride_style: 'Quiet' }),
    [],
  )
  assert.equal(isProfileComplete({ full_name: 'Jo', phone: '8645551212', bio: '12345678', ride_style: 'Quiet' }), true)
  assert.equal(
    profileFieldError({}),
    'Add your full name, mobile number, short bio, ride style to finish your profile.',
  )
  assert.match(profileFieldError({ ...complete, phone: '5' }), /mobile number/)
  assert.equal(profileFieldError(null), profileFieldError({}))
})

test('profile rows keep a too-short name and mixed ride styles', () => {
  assert.deepEqual(profileRowFromUser(null), {})
  assert.deepEqual(profileRowFromUser({ user_metadata: { full_name: '  ', phone: '   ', bio: 'short', ride_style: '  ' } }), {})
  assert.deepEqual(
    profileRowFromUser({ user_metadata: { name: 'From Name', phone: '123', bio: 'short', ride_style: 'nope' } }),
    { full_name: 'From Name' },
  )

  const stored = profileRowFromUser({
    user_metadata: {
      full_name: 'J',
      phone: '1-864-555-1212',
      bio: '12345678',
      ride_style: 'Quiet | NotAStyle',
    },
  })
  assert.equal(stored.full_name, 'J')
  assert.equal(stored.phone, '18645551212')
  assert.equal(stored.bio, '12345678')
  assert.equal(stored.ride_style, 'Quiet | NotAStyle')
  // BUG?: a one-character name is stored even though isProfileComplete rejects it.
  assert.equal(isProfileComplete(stored), false)
  assert.deepEqual(missingProfileFields(stored), ['full_name'])
  // BUG?: ride_style keeps invalid tokens when at least one token is a known style.

  const clipped = profileRowFromUser({
    user_metadata: {
      full_name: 'N'.repeat(100),
      phone: '1234567890123456',
      bio: 'x'.repeat(300),
      ride_style: 'AC max',
    },
  })
  assert.equal(clipped.full_name.length, 80)
  assert.equal(clipped.phone, '123456789012345')
  assert.equal(clipped.bio.length, 280)
  // BUG?: a digit run of 11–15 is stored as a phone, and 16 digits are sliced to 15, with no check that it is a real mobile number.
  assert.equal(missingProfileFields(clipped).includes('phone'), false)
})

test('signup metadata drops invalid contact fields but can still store a one-character name', () => {
  assert.deepEqual(signupProfileMetadata(), {})
  assert.deepEqual(signupProfileMetadata({}), {})
  const promoOnly = signupProfileMetadata({
    fullName: 'J',
    phone: '5',
    bio: 'hi',
    rideStyle: 'nope',
    promoCode: '  ok!! ',
  })
  assert.deepEqual(promoOnly, { full_name: 'J', promo_code: 'OK' })
  // BUG?: signup metadata persists a one-character name that profileFieldError still rejects.
  assert.match(profileFieldError(promoOnly), /full name/)

  assert.equal(signupProfileMetadata({ promoCode: '---' }).promo_code, undefined)
  assert.equal(signupProfileMetadata({ promoCode: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' }).promo_code, 'ABCDEFGHIJKLMNOP')
  const tiger = signupProfileMetadata({
    fullName: 'Jo',
    phone: '8645551212',
    bio: '12345678',
    rideStyle: 'Quiet',
    promoCode: '  tiger-1!! ',
  })
  assert.equal(tiger.promo_code, 'TIGER1')
  assert.equal(isProfileComplete(tiger), true)
})

test('signup drafts coerce odd JSON and whitespace metadata blocks the merge', () => {
  assert.equal(readSignupDraft(''), null)
  assert.equal(readSignupDraft('  '), null)
  assert.equal(readSignupDraft(null), null)
  assert.equal(readSignupDraft(12), null)
  assert.equal(readSignupDraft('null'), null)
  assert.equal(readSignupDraft('1'), null)
  assert.equal(readSignupDraft('true'), null)
  assert.equal(readSignupDraft('"hi"'), null)
  assert.deepEqual(readSignupDraft('{}'), {
    fullName: '',
    phone: '',
    bio: '',
    rideStyle: '',
    promo: '',
  })
  // BUG?: a JSON array passes the object check and becomes an empty draft.
  assert.deepEqual(readSignupDraft('[]'), {
    fullName: '',
    phone: '',
    bio: '',
    rideStyle: '',
    promo: '',
  })
  const coerced = readSignupDraft(JSON.stringify({
    fullName: { a: 1 },
    phone: null,
    bio: ['Music on the way.'],
    rideStyle: false,
    promo: ['pal'],
  }))
  assert.equal(coerced.fullName, '[object Object]')
  assert.equal(coerced.phone, '')
  assert.equal(coerced.bio, 'Music on the way.')
  assert.equal(coerced.rideStyle, '')
  assert.equal(coerced.promo, 'pal')
  // BUG?: non-string draft fields are coerced with String(), so objects become "[object Object]" and arrays are joined.

  const draft = {
    fullName: 'Avery Chen',
    phone: '8645550100',
    bio: 'Music on the way.',
    rideStyle: 'Music on',
    promo: 'pal',
  }
  assert.equal(userWithDraft(null, draft), null)
  assert.deepEqual(userWithDraft({ id: 'u', email: 'a@b.c' }, null), { id: 'u', email: 'a@b.c' })
  const bare = userWithDraft({ id: 'u' }, draft)
  assert.equal(bare.user_metadata.full_name, 'Avery Chen')
  assert.equal(bare.user_metadata.promo_code, 'pal')
  assert.equal(bare.id, 'u')

  const blocked = {
    id: 'u',
    user_metadata: { full_name: ' ', phone: ' ', bio: ' ', ride_style: ' ', promo_code: ' ' },
  }
  const merged = userWithDraft(blocked, draft)
  assert.equal(merged.user_metadata.bio, ' ')
  assert.equal(merged.user_metadata.phone, ' ')
  // BUG?: whitespace-only metadata is truthy, so a stored signup draft does not fill those fields.
  assert.equal(blocked.user_metadata.bio, ' ')

  const shortBio = userWithDraft({ id: 'u', user_metadata: { bio: 'short' } }, draft)
  assert.equal(shortBio.user_metadata.bio, 'short')
  assert.equal(shortBio.user_metadata.ride_style, 'Music on')
})

test('ensure fills a blank profile and leaves a short phone or one-character name in place', () => {
  const fromEmail = buildEnsureProfilePatch(null, { id: 'u', email: 'jo@clemson.edu' }, 't', false)
  assert.equal(fromEmail.full_name, 'jo')
  assert.equal(fromEmail.email, 'jo@clemson.edu')
  assert.equal(fromEmail.student_verified_at, undefined)

  const riderFallback = buildEnsureProfilePatch(null, { id: 'u' }, 't', true)
  assert.equal(riderFallback.full_name, 'Rider')
  assert.equal(riderFallback.email, null)
  assert.equal(riderFallback.student_verified_at, 't')

  const shortName = buildEnsureProfilePatch(null, {
    id: 'u',
    email: 'jordan@clemson.edu',
    user_metadata: { full_name: 'J' },
  }, 't', false)
  assert.equal(shortName.full_name, 'J')
  // BUG?: a one-character signup name beats the email fallback and still fails the 2-character name rule.
  assert.equal(shortName.full_name.length < 2, true)

  const localPart = buildEnsureProfilePatch(null, { id: 'u', email: 'a@clemson.edu' }, 't', false)
  assert.equal(localPart.full_name, 'a')
  // BUG?: the email local-part is stored even when it is shorter than the 2-character name rule.

  const kept = buildEnsureProfilePatch(
    { full_name: 'J', phone: '5', bio: 'long enough', ride_style: 'Quiet', student_verified_at: '2026-01-01' },
    {
      id: 'u',
      email: 'new@clemson.edu',
      user_metadata: { full_name: 'Jordan Lee', phone: '8645551212', bio: 'From signup.', ride_style: 'Chatty' },
    },
    't',
    true,
  )
  assert.equal(kept.full_name, undefined)
  assert.equal(kept.phone, undefined)
  assert.equal(kept.bio, undefined)
  assert.equal(kept.ride_style, undefined)
  assert.equal(kept.student_verified_at, undefined)
  assert.equal(kept.email, 'new@clemson.edu')
  // BUG?: a non-empty phone shorter than 10 digits is kept, so ensure never repairs it from signup metadata.
  // BUG?: one-character full_name counts as present, so ensure will not fill the signup name.

  const whitespace = buildEnsureProfilePatch(
    { full_name: ' ', phone: ' ', bio: ' ', ride_style: ' ' },
    {
      id: 'u',
      email: 'a@b.co',
      user_metadata: { full_name: 'Jordan Lee', phone: '8645551212', bio: 'From signup.', ride_style: 'Quiet' },
    },
    'now',
    false,
  )
  assert.equal(whitespace.full_name, 'Jordan Lee')
  assert.equal(whitespace.phone, '8645551212')
  assert.equal(whitespace.bio, 'From signup.')
  assert.equal(whitespace.ride_style, 'Quiet')
})

test('profile setup redirects every signed-in incomplete route except the open list', () => {
  for (const segment of ['sign-in', 'sign-up', 'forgot-password', 'reset-password', 'set-password', 'auth', 'profile-setup']) {
    assert.equal(shouldRedirectToProfileSetup({ signedIn: true, complete: false, segment }), false, segment)
  }
  assert.equal(shouldRedirectToProfileSetup({ signedIn: true, complete: false, segment: '' }), true)
  assert.equal(shouldRedirectToProfileSetup({ signedIn: true, complete: false }), true)
  assert.equal(shouldRedirectToProfileSetup({ signedIn: true, complete: false, segment: 'index' }), true)
  // BUG?: open-route names are case-sensitive, so "Sign-in" still redirects into profile setup.
  assert.equal(shouldRedirectToProfileSetup({ signedIn: true, complete: false, segment: 'Sign-in' }), true)
  assert.equal(shouldLeaveProfileSetup({ signedIn: true, complete: true, segment: '(tabs)' }), false)
  assert.equal(shouldLeaveProfileSetup({ signedIn: false, complete: true, segment: 'profile-setup' }), false)
  assert.equal(shouldLeaveProfileSetup({}), false)
})

test('counterpart id follows the visible trip statuses and never returns yourself', () => {
  const trip = { status: 'accepted', rider_id: 'rider', driver_id: 'driver' }
  for (const status of PARTY_VISIBLE_STATUSES) {
    assert.equal(counterpartId({ ...trip, status }, 'rider'), 'driver', status)
    assert.equal(counterpartId({ ...trip, status }, 'driver'), 'rider', status)
  }
  for (const status of ['searching', 'offered', 'canceled', 'cancelled', 'cancelled_wait', 'canceled_midride', 'requested', 'Completed']) {
    assert.equal(counterpartId({ ...trip, status }, 'rider'), null, status)
  }
  assert.equal(counterpartId(null, 'rider'), null)
  assert.equal(counterpartId(trip, ''), null)
  assert.equal(counterpartId({ status: 'accepted', rider_id: 'rider', driver_id: null }, 'rider'), null)
  assert.equal(counterpartId({ status: 'accepted', rider_id: null, driver_id: 'driver' }, 'driver'), null)
  assert.equal(counterpartId(trip, 'stranger'), null)
  assert.equal(counterpartId({ status: 'in_progress', rider_id: 'same', driver_id: 'same' }, 'same'), null)
})

test('rating checks run before the party check and mislabel a missing rider', () => {
  assert.equal(ratingBlockReason(null, 'rider'), 'Trip not found')
  assert.equal(ratingBlockReason({ status: 'completed', rider_id: 'rider', driver_id: 'driver' }, ''), 'Sign in to rate this ride')
  assert.match(
    ratingBlockReason({ status: 'arriving', rider_id: 'rider', driver_id: 'driver' }, 'rider'),
    /not completed/,
  )
  assert.equal(
    ratingBlockReason({ status: 'completed', rider_id: 'rider', driver_id: 'driver' }, 'driver'),
    null,
  )
  // BUG?: a user who is not on the trip learns that the trip is unfinished before the party check.
  assert.match(
    ratingBlockReason({ status: 'in_progress', rider_id: 'rider', driver_id: 'driver' }, 'stranger'),
    /not completed/,
  )
  // BUG?: a stranger is told that a completed trip has no driver yet.
  assert.match(
    ratingBlockReason({ status: 'completed', rider_id: 'rider', driver_id: null }, 'stranger'),
    /no driver/,
  )
  assert.match(
    ratingBlockReason({ status: 'completed', rider_id: 'rider', driver_id: null }, 'rider'),
    /no driver/,
  )
  // BUG?: a driver on a completed trip with no rider_id gets "Cannot rate yourself".
  assert.equal(
    ratingBlockReason({ status: 'completed', rider_id: null, driver_id: 'driver' }, 'driver'),
    'Cannot rate yourself',
  )
})

test('stars accept values that coerce to an integer from 1 to 5', () => {
  assert.equal(validateStars(1), null)
  assert.equal(validateStars(5), null)
  assert.equal(validateStars('5'), null)
  assert.equal(validateStars('5.0'), null)
  assert.match(validateStars(0), /1–5/)
  assert.match(validateStars(6), /1–5/)
  assert.match(validateStars(-1), /1–5/)
  assert.match(validateStars(1.5), /1–5/)
  assert.match(validateStars(false), /1–5/)
  assert.match(validateStars(null), /1–5/)
  assert.match(validateStars(undefined), /1–5/)
  assert.match(validateStars(''), /1–5/)
  assert.match(validateStars('five'), /1–5/)
  assert.match(validateStars(Number.NaN), /1–5/)
  assert.match(validateStars(Number.POSITIVE_INFINITY), /1–5/)
  // BUG?: boolean true, padded numeric strings, and scientific notation count as real star ratings.
  assert.equal(validateStars(true), null)
  assert.equal(validateStars(' 3 '), null)
  assert.equal(validateStars('1e0'), null)
  assert.equal(validateStars(5n), null)
})

test('rating lines print unclamped and non-integer counts', () => {
  assert.equal(formatRatingLine(null, 3), 'New · no ratings yet')
  assert.equal(formatRatingLine(undefined, 3), 'New · no ratings yet')
  assert.equal(formatRatingLine('nope', 3), 'New · no ratings yet')
  assert.equal(formatRatingLine(5, 0), 'New · no ratings yet')
  assert.equal(formatRatingLine(5, ''), 'New · no ratings yet')
  assert.equal(formatRatingLine('4.24', '2'), '4.2 · 2 ratings')
  assert.equal(formatRatingLine(4.25, 2), '4.3 · 2 ratings')
  assert.equal(formatRatingLine(1.05, 1), '1.1 · 1 rating')
  // BUG?: 4.85 is a binary fraction just under 4.85, so toFixed(1) prints 4.8.
  assert.equal(formatRatingLine(4.85, 2), '4.8 · 2 ratings')
  // BUG?: negative and fractional counts are printed instead of treated as no ratings.
  assert.equal(formatRatingLine(4, -3), '4.0 · -3 ratings')
  assert.equal(formatRatingLine(4, 1.5), '4.0 · 1.5 ratings')
  // BUG?: boolean true is a count of 1.
  assert.equal(formatRatingLine(4.2, true), '4.2 · 1 rating')
  // BUG?: averages outside 1–5 are not clamped.
  assert.equal(formatRatingLine(0, 3), '0.0 · 3 ratings')
  assert.equal(formatRatingLine(100, 2), '100.0 · 2 ratings')
  assert.equal(formatRatingLine(-1, 2), '-1.0 · 2 ratings')
})

test('spot lists drop blanks and cap at six without trimming', () => {
  assert.deepEqual(asSpotList(null), [])
  assert.deepEqual(asSpotList(3), [])
  assert.deepEqual(asSpotList({ 0: 'A' }), [])
  assert.deepEqual(asSpotList('not json'), [])
  assert.deepEqual(
    asSpotList('["Cooper Library", "  ", "Tillman", 3, null, "Bowman"]'),
    ['Cooper Library', 'Tillman', 'Bowman'],
  )
  assert.deepEqual(asSpotList('"[\\"A\\"]"'), ['A'])
  assert.deepEqual(asSpotList(['a', 'b', 'c', 'd', 'e', 'f', 'g']), ['a', 'b', 'c', 'd', 'e', 'f'])
  // BUG?: spots that contain non-whitespace characters keep their surrounding spaces.
  assert.deepEqual(asSpotList(['  Library  ', '', '   ']), ['  Library  '])
})

test('vehicle labels join color make and model and drop falsy parts', () => {
  assert.equal(partyProfile.vehicleLabelFromRow(null), '')
  assert.equal(partyProfile.vehicleLabelFromRow(''), '')
  assert.equal(partyProfile.vehicleLabelFromRow(0), '')
  assert.equal(partyProfile.vehicleLabelFromRow({ color: 'White', model: 'Model 3' }), 'White Model 3')
  assert.equal(partyProfile.vehicleLabelFromRow({ color: false, make: 'Honda', model: '' }), 'Honda')
  // BUG?: a numeric 0 color is falsy, so it disappears from the label.
  assert.equal(partyProfile.vehicleLabelFromRow({ color: 0, make: 'Tesla', model: '3' }), 'Tesla 3')
  // BUG?: a string vehicle label is returned untrimmed.
  assert.equal(partyProfile.vehicleLabelFromRow('  White Tesla  '), '  White Tesla  ')
})

test('counterpart view uses the first name, rider fallback, and raw rating fields', () => {
  const driver = toCounterpartView({ full_name: '!!!' }, { viewerIsRider: true })
  assert.equal(driver.name, 'Driver')
  assert.equal(driver.initial, 'D')
  assert.equal(driver.roleLabel, 'Your driver')
  assert.equal(driver.ratingLine, 'New · no ratings yet')
  assert.equal(driver.vehicle, '')

  const rider = toCounterpartView({
    id: 'rider',
    full_name: 'sam lee',
    rating_avg: '',
    rating_count: 0,
    student_verified_at: 'no',
    favorite_spots: ['  Library  '],
    phone: '8645551212',
  })
  assert.equal(rider.name, 'sam')
  assert.equal(rider.initial, 'S')
  assert.equal(rider.roleLabel, 'Your rider')
  assert.equal(rider.ratingLine, 'New · no ratings yet')
  assert.equal(rider.phone, '(864) 555-1212')
  // BUG?: rating_avg "" is not null, so ratingAvg becomes Number("") === 0.
  assert.equal(rider.ratingAvg, 0)
  assert.equal(rider.ratingCount, 0)
  // BUG?: any truthy student_verified_at counts as verified, including the string "no".
  assert.equal(rider.student, true)
  // BUG?: favorite spots are passed through asSpotList, which does not trim them.
  assert.deepEqual(rider.spots, ['  Library  '])

  assert.equal(toCounterpartView(null), null)
  const zero = toCounterpartView({ full_name: 'Sam', rating_avg: 0, rating_count: 0 })
  assert.equal(zero.ratingAvg, 0)
  assert.equal(zero.ratingLine, 'New · no ratings yet')
})

function fakeSupabase({ tables = {}, rpc = { data: null, error: null } } = {}) {
  const calls = []

  function take(table) {
    const queue = tables[table]
    if (!queue || queue.length === 0) return { data: null, error: null }
    return queue.shift()
  }

  function settle(table) {
    const spec = take(table)
    if (spec && spec.__throw) return Promise.reject(spec.__throw)
    return Promise.resolve(spec)
  }

  function chain(table) {
    const api = {
      select(columns) {
        calls.push({ op: 'select', table, columns })
        return api
      },
      eq(col, val) {
        calls.push({ op: 'eq', table, col, val })
        return api
      },
      or(filter) {
        calls.push({ op: 'or', table, filter })
        return api
      },
      not(col, operator, val) {
        calls.push({ op: 'not', table, col, operator, val })
        return api
      },
      order(col, opts) {
        calls.push({ op: 'order', table, col, opts })
        return api
      },
      limit(n) {
        calls.push({ op: 'limit', table, n })
        return settle(table)
      },
      update(payload) {
        calls.push({ op: 'update', table, payload })
        return api
      },
      insert(payload) {
        calls.push({ op: 'insert', table, payload })
        return api
      },
      maybeSingle() {
        calls.push({ op: 'maybeSingle', table })
        return settle(table)
      },
      single() {
        calls.push({ op: 'single', table })
        return settle(table)
      },
      then(onFulfilled, onRejected) {
        return settle(table).then(onFulfilled, onRejected)
      },
    }
    return api
  }

  return {
    calls,
    from(table) {
      calls.push({ op: 'from', table })
      return chain(table)
    },
    rpc(fn, args) {
      calls.push({ op: 'rpc', fn, args })
      if (typeof rpc === 'function') return Promise.resolve(rpc(fn, args))
      if (rpc && rpc.__throw) return Promise.reject(rpc.__throw)
      return Promise.resolve(rpc)
    },
  }
}

const OWN_COLUMNS = 'id, full_name, phone, bio, ride_style, favorite_spots, rating_avg, rating_count, avatar_url, student_verified_at'
const OWN_FALLBACK = 'id, full_name, phone'
const PUBLIC_COLUMNS = 'id, full_name, avatar_url, bio, ride_style, favorite_spots, music_taste, rating_avg, rating_count, student_verified_at, phone, role'
const PUBLIC_FALLBACK = 'id, full_name, avatar_url, phone'

test('loadOwnProfile returns null without a client and retries when the error mentions a column', async () => {
  assert.equal(await loadOwnProfile(null, 'user-1'), null)
  assert.equal(await loadOwnProfile(fakeSupabase(), ''), null)

  const missing = fakeSupabase({
    tables: { profiles: [{ data: null, error: null }] },
  })
  assert.equal(await loadOwnProfile(missing, 'user-1'), null)
  assert.equal(missing.calls.find((call) => call.op === 'select').columns, OWN_COLUMNS)
  assert.deepEqual(
    missing.calls.find((call) => call.op === 'eq'),
    { op: 'eq', table: 'profiles', col: 'id', val: 'user-1' },
  )

  const row = { id: 'user-1', full_name: 'Jo' }
  const recovered = fakeSupabase({
    tables: {
      profiles: [
        { data: null, error: { message: 'column favorite_spots does not exist' } },
        { data: row, error: null },
      ],
    },
  })
  assert.deepEqual(await loadOwnProfile(recovered, 'user-1'), row)
  const selects = recovered.calls.filter((call) => call.op === 'select')
  assert.deepEqual(selects.map((call) => call.columns), [OWN_COLUMNS, OWN_FALLBACK])

  const swallowed = fakeSupabase({
    tables: {
      profiles: [
        { data: null, error: { message: 'duplicate key value violates unique constraint on column id' } },
        { data: row, error: null },
      ],
    },
  })
  // BUG?: any error message containing "column" is treated as a missing-column retry, so this unique-constraint error is swallowed.
  assert.deepEqual(await loadOwnProfile(swallowed, 'user-1'), row)

  const broken = fakeSupabase({
    tables: { profiles: [{ data: null, error: { message: 'connection reset' } }] },
  })
  await assert.rejects(() => loadOwnProfile(broken, 'user-1'), /connection reset/)

  const blank = fakeSupabase({
    tables: { profiles: [{ data: null, error: { message: undefined } }] },
  })
  await assert.rejects(() => loadOwnProfile(blank, 'user-1'), (err) => err.message === '')
})

test('loadPublicProfile prefers the counterpart RPC and falls back only for missing-function errors', async () => {
  assert.equal(await loadPublicProfile(null, 'driver'), null)
  assert.equal(await loadPublicProfile(fakeSupabase(), ''), null)

  const row = { id: 'driver', full_name: 'Sam Okonkwo' }
  const direct = fakeSupabase({ rpc: { data: row, error: null } })
  assert.deepEqual(await loadPublicProfile(direct, 'driver'), row)
  assert.deepEqual(direct.calls[0], { op: 'rpc', fn: 'counterpart_profile', args: { target: 'driver' } })
  assert.equal(direct.calls.some((call) => call.op === 'from'), false)

  const firstOf = fakeSupabase({ rpc: { data: [row, { id: 'other' }], error: null } })
  assert.deepEqual(await loadPublicProfile(firstOf, 'driver'), row)
  const empty = fakeSupabase({ rpc: { data: [], error: null } })
  assert.equal(await loadPublicProfile(empty, 'driver'), null)

  const fallback = fakeSupabase({
    rpc: { data: null, error: { message: 'Could not find the function public.counterpart_profile in the schema cache' } },
    tables: { profiles: [{ data: row, error: null }] },
  })
  assert.deepEqual(await loadPublicProfile(fallback, 'driver'), row)
  assert.equal(fallback.calls.find((call) => call.op === 'select').columns, PUBLIC_COLUMNS)

  const narrow = fakeSupabase({
    rpc: { data: null, error: { message: 'function counterpart_profile does not exist' } },
    tables: {
      profiles: [
        { data: null, error: { message: 'column favorite_spots does not exist' } },
        { data: { id: 'driver', full_name: 'Sam' }, error: null },
      ],
    },
  })
  assert.deepEqual(await loadPublicProfile(narrow, 'driver'), { id: 'driver', full_name: 'Sam' })
  assert.deepEqual(
    narrow.calls.filter((call) => call.op === 'select').map((call) => call.columns),
    [PUBLIC_COLUMNS, PUBLIC_FALLBACK],
  )

  const denied = fakeSupabase({
    rpc: { data: null, error: { message: 'permission denied for function counterpart_profile' } },
    tables: { profiles: [{ data: row, error: null }] },
  })
  // BUG?: an RPC error that mentions "function" or "counterpart_profile" is treated as a missing RPC, including permission denied, and the row is selected directly.
  assert.deepEqual(await loadPublicProfile(denied, 'driver'), row)

  const expired = fakeSupabase({
    rpc: { data: null, error: { message: 'JWT expired' } },
  })
  await assert.rejects(() => loadPublicProfile(expired, 'driver'), /JWT expired/)
})

test('saveOwnProfile writes the trimmed digits and rejects an incomplete draft', async () => {
  await assert.rejects(() => saveOwnProfile(null, 'user-1', complete), /Sign in to save your profile/)
  await assert.rejects(() => saveOwnProfile(fakeSupabase(), '', complete), /Sign in to save your profile/)

  const invalid = fakeSupabase()
  await assert.rejects(() => saveOwnProfile(invalid, 'user-1', { full_name: 'J', phone: '5', bio: 'hi', ride_style: 'quiet' }), /full name/)
  assert.equal(invalid.calls.length, 0)

  const client = fakeSupabase({
    tables: { profiles: [{ data: null, error: null }] },
  })
  const before = Date.now()
  const saved = await saveOwnProfile(client, 'user-1', {
    full_name: '  Jordan Lee  ',
    phone: '(864) 555-1212',
    bio: `  ${'x'.repeat(300)}  `,
    ride_style: ' Quiet ',
    favorite_spots: ['Cooper Library'],
  })
  assert.equal(saved.full_name, 'Jordan Lee')
  assert.equal(saved.phone, '8645551212')
  assert.equal(saved.bio.length, 280)
  assert.equal(saved.ride_style, 'Quiet')
  assert.equal(saved.favorite_spots, undefined)
  const update = client.calls.find((call) => call.op === 'update')
  assert.equal(update.payload.full_name, 'Jordan Lee')
  assert.equal(update.payload.phone, '8645551212')
  assert.equal(update.payload.bio.length, 280)
  assert.equal(update.payload.ride_style, 'Quiet')
  assert.equal(update.payload.favorite_spots, undefined)
  assert.match(update.payload.updated_at, /^\d{4}-\d{2}-\d{2}T/)
  assert.ok(Date.parse(update.payload.updated_at) >= before - 1000)
  assert.deepEqual(client.calls.find((call) => call.op === 'eq'), { op: 'eq', table: 'profiles', col: 'id', val: 'user-1' })

  const failed = fakeSupabase({
    tables: { profiles: [{ data: null, error: { message: 'write failed' } }] },
  })
  await assert.rejects(
    () => saveOwnProfile(failed, 'user-1', complete),
    /write failed/,
  )
})

test('loadCounterpart shows the other party and a vehicle only to the rider', async () => {
  assert.equal(await loadCounterpart(null, { status: 'accepted', rider_id: 'rider', driver_id: 'driver' }, 'rider'), null)
  const hidden = fakeSupabase()
  assert.equal(await loadCounterpart(hidden, { status: 'offered', rider_id: 'rider', driver_id: 'driver' }, 'rider'), null)
  assert.equal(hidden.calls.length, 0)

  const profile = {
    id: 'driver',
    full_name: 'Sam Okonkwo',
    rating_avg: 4.9,
    rating_count: 8,
    bio: 'Campus to CLT.',
    ride_style: 'Chatty',
    favorite_spots: ['Cooper Library'],
    phone: '8645551212',
    student_verified_at: '2026-01-01',
  }
  const asRider = fakeSupabase({
    rpc: { data: profile, error: null },
    tables: { vehicles: [{ data: [{ color: 'White', make: 'Tesla', model: 'Model 3' }], error: null }] },
  })
  const riderView = await loadCounterpart(
    asRider,
    { status: 'accepted', rider_id: 'rider', driver_id: 'driver' },
    'rider',
  )
  assert.equal(riderView.name, 'Sam')
  assert.equal(riderView.roleLabel, 'Your driver')
  assert.equal(riderView.vehicle, 'White Tesla Model 3')
  assert.equal(asRider.calls.find((call) => call.op === 'rpc').args.target, 'driver')
  assert.equal(asRider.calls.some((call) => call.table === 'vehicles'), true)

  const asDriver = fakeSupabase({
    rpc: { data: { ...profile, id: 'rider', full_name: 'Jordan Lee' }, error: null },
    tables: { vehicles: [{ data: [{ color: 'Red', make: 'Honda', model: 'Civic' }], error: null }] },
  })
  const driverView = await loadCounterpart(
    asDriver,
    { status: 'in_progress', rider_id: 'rider', driver_id: 'driver' },
    'driver',
  )
  assert.equal(driverView.name, 'Jordan')
  assert.equal(driverView.roleLabel, 'Your rider')
  assert.equal(driverView.vehicle, '')
  assert.equal(asDriver.calls.some((call) => call.table === 'vehicles'), false)

  const noProfile = fakeSupabase({ rpc: { data: null, error: null } })
  assert.equal(
    await loadCounterpart(noProfile, { status: 'arrived', rider_id: 'rider', driver_id: 'driver' }, 'rider'),
    null,
  )

  const vehicleDown = fakeSupabase({
    rpc: { data: profile, error: null },
    tables: { vehicles: [{ data: null, error: { message: 'vehicles offline' } }] },
  })
  const withoutVehicle = await loadCounterpart(
    vehicleDown,
    { status: 'arriving', rider_id: 'rider', driver_id: 'driver' },
    'rider',
  )
  assert.equal(withoutVehicle.vehicle, '')

  const vehicleThrew = fakeSupabase({
    rpc: { data: profile, error: null },
    tables: { vehicles: [{ __throw: new Error('network') }] },
  })
  const caught = await loadCounterpart(
    vehicleThrew,
    { status: 'completed', rider_id: 'rider', driver_id: 'driver' },
    'rider',
  )
  assert.equal(caught.vehicle, '')
  assert.equal(caught.roleLabel, 'Your driver')
})

test('fetchTripForRating and hasRatedTrip distinguish a missing table from a hard error', async () => {
  assert.equal(await fetchTripForRating(null, 'trip-1'), null)
  assert.equal(await fetchTripForRating(fakeSupabase(), ''), null)
  const trip = { id: 'trip-1', status: 'completed', rider_id: 'rider', driver_id: 'driver' }
  const loaded = fakeSupabase({ tables: { trips: [{ data: trip, error: null }] } })
  assert.deepEqual(await fetchTripForRating(loaded, 'trip-1'), trip)
  assert.match(loaded.calls.find((call) => call.op === 'select').columns, /completed_at/)
  const missingTrip = fakeSupabase({ tables: { trips: [{ data: null, error: null }] } })
  assert.equal(await fetchTripForRating(missingTrip, 'trip-1'), null)
  const badTrip = fakeSupabase({ tables: { trips: [{ data: null, error: { message: 'trip read failed' } }] } })
  await assert.rejects(() => fetchTripForRating(badTrip, 'trip-1'), /trip read failed/)

  assert.equal(await hasRatedTrip(null, 'trip-1', 'rider'), false)
  assert.equal(await hasRatedTrip(fakeSupabase(), '', 'rider'), false)
  assert.equal(await hasRatedTrip(fakeSupabase(), 'trip-1', ''), false)
  const rated = fakeSupabase({ tables: { ratings: [{ data: { id: 'rating-1' }, error: null }] } })
  assert.equal(await hasRatedTrip(rated, 'trip-1', 'rider'), true)
  const eqs = rated.calls.filter((call) => call.op === 'eq')
  assert.deepEqual(eqs.map((call) => [call.col, call.val]), [['trip_id', 'trip-1'], ['rater_id', 'rider']])

  const unrated = fakeSupabase({ tables: { ratings: [{ data: null, error: null }] } })
  assert.equal(await hasRatedTrip(unrated, 'trip-1', 'rider'), false)

  for (const message of ['relation "ratings" does not exist', 'schema cache miss']) {
    const client = fakeSupabase({ tables: { ratings: [{ data: null, error: { message } }] } })
    assert.equal(await hasRatedTrip(client, 'trip-1', 'rider'), false, message)
  }
  // BUG?: a missing ratings table is reported as "not rated", so the caller still offers the rating form.

  const noId = fakeSupabase({ tables: { ratings: [{ data: {}, error: null }] } })
  // BUG?: a ratings row with no id is treated as not rated.
  assert.equal(await hasRatedTrip(noId, 'trip-1', 'rider'), false)

  const locked = fakeSupabase({
    tables: { ratings: [{ data: null, error: { message: 'new row violates row-level security policy' } }] },
  })
  await assert.rejects(
    () => hasRatedTrip(locked, 'trip-1', 'rider'),
    /only the other person on that trip/,
  )
  const duplicate = fakeSupabase({
    tables: { ratings: [{ data: null, error: { message: 'duplicate key value violates unique constraint' } }] },
  })
  await assert.rejects(() => hasRatedTrip(duplicate, 'trip-1', 'rider'), /You already rated this trip/)
  const plain = fakeSupabase({
    tables: { ratings: [{ data: null, error: { message: 'connection reset' } }] },
  })
  await assert.rejects(() => hasRatedTrip(plain, 'trip-1', 'rider'), /connection reset/)
  const emptyMessage = fakeSupabase({
    tables: { ratings: [{ data: null, error: { message: '' } }] },
  })
  await assert.rejects(() => hasRatedTrip(emptyMessage, 'trip-1', 'rider'), /Could not submit rating/)
})

test('submitPartyRating inserts the other party and rewrites database errors', async () => {
  await assert.rejects(() => submitPartyRating(null, { tripId: 'trip-1', raterId: 'rider', stars: 5 }), /Supabase is not configured/)
  const badStars = fakeSupabase()
  await assert.rejects(
    () => submitPartyRating(badStars, { tripId: 'trip-1', raterId: 'rider', stars: 0 }),
    /1–5/,
  )
  assert.equal(badStars.calls.length, 0)

  const trip = { id: 'trip-1', status: 'completed', rider_id: 'rider', driver_id: 'driver' }
  const open = fakeSupabase({
    tables: { trips: [{ data: { ...trip, status: 'in_progress' }, error: null }] },
  })
  await assert.rejects(
    () => submitPartyRating(open, { tripId: 'trip-1', raterId: 'rider', stars: 5 }),
    /not completed/,
  )

  const already = fakeSupabase({
    tables: {
      trips: [{ data: trip, error: null }],
      ratings: [{ data: { id: 'rating-1' }, error: null }],
    },
  })
  await assert.rejects(
    () => submitPartyRating(already, { tripId: 'trip-1', raterId: 'rider', stars: 5 }),
    /You already rated this trip/,
  )
  assert.equal(already.calls.some((call) => call.op === 'insert'), false)

  const client = fakeSupabase({
    tables: {
      trips: [{ data: trip, error: null }],
      ratings: [
        { data: null, error: null },
        { data: { id: 'rating-2', stars: 5 }, error: null },
      ],
    },
  })
  const comment = `  ${'thanks '.repeat(80)}  `
  const saved = await submitPartyRating(client, { tripId: 'trip-1', raterId: 'rider', stars: '5', comment })
  assert.deepEqual(saved, { id: 'rating-2', stars: 5 })
  const inserted = client.calls.find((call) => call.op === 'insert')
  assert.equal(inserted.payload.trip_id, 'trip-1')
  assert.equal(inserted.payload.rater_id, 'rider')
  assert.equal(inserted.payload.ratee_id, 'driver')
  assert.equal(inserted.payload.stars, 5)
  assert.equal(inserted.payload.comment.length, 280)
  assert.deepEqual(
    client.calls.filter((call) => call.op === 'select' && call.table === 'ratings').map((call) => call.columns),
    ['id', 'id, stars'],
  )

  const fromDriver = fakeSupabase({
    tables: {
      trips: [{ data: trip, error: null }],
      ratings: [
        { data: null, error: null },
        { data: { id: 'rating-3', stars: 4 }, error: null },
      ],
    },
  })
  await submitPartyRating(fromDriver, { tripId: 'trip-1', raterId: 'driver', stars: 4, comment: '   ' })
  const driverInsert = fromDriver.calls.find((call) => call.op === 'insert')
  assert.equal(driverInsert.payload.ratee_id, 'rider')
  assert.equal(driverInsert.payload.comment, null)

  const coerced = fakeSupabase({
    tables: {
      trips: [{ data: trip, error: null }],
      ratings: [
        { data: null, error: null },
        { data: { id: 'rating-4', stars: 1 }, error: null },
      ],
    },
  })
  await submitPartyRating(coerced, { tripId: 'trip-1', raterId: 'rider', stars: true })
  // BUG?: validateStars(true) succeeds, so boolean true is inserted as 1 star.
  assert.equal(coerced.calls.find((call) => call.op === 'insert').payload.stars, 1)

  const rls = fakeSupabase({
    tables: {
      trips: [{ data: trip, error: null }],
      ratings: [
        { data: null, error: null },
        { data: null, error: { message: 'new row violates row-level security policy (42501)' } },
      ],
    },
  })
  await assert.rejects(
    () => submitPartyRating(rls, { tripId: 'trip-1', raterId: 'rider', stars: 5 }),
    /only the other person on that trip/,
  )
  const unique = fakeSupabase({
    tables: {
      trips: [{ data: trip, error: null }],
      ratings: [
        { data: null, error: null },
        { data: null, error: { message: 'duplicate key value violates unique constraint 23505' } },
      ],
    },
  })
  await assert.rejects(
    () => submitPartyRating(unique, { tripId: 'trip-1', raterId: 'rider', stars: 5 }),
    /You already rated this trip/,
  )
  const other = fakeSupabase({
    tables: {
      trips: [{ data: trip, error: null }],
      ratings: [
        { data: null, error: null },
        { data: null, error: { message: 'connection reset' } },
      ],
    },
  })
  await assert.rejects(
    () => submitPartyRating(other, { tripId: 'trip-1', raterId: 'rider', stars: 5 }),
    /connection reset/,
  )
  const noRow = fakeSupabase({
    tables: {
      trips: [{ data: trip, error: null }],
      ratings: [
        { data: null, error: null },
        { data: { stars: 5 }, error: null },
      ],
    },
  })
  await assert.rejects(
    () => submitPartyRating(noRow, { tripId: 'trip-1', raterId: 'rider', stars: 5 }),
    /Rating was not saved/,
  )
  const unread = fakeSupabase({
    tables: { trips: [{ data: null, error: { message: 'trip read failed' } }] },
  })
  await assert.rejects(
    () => submitPartyRating(unread, { tripId: 'trip-1', raterId: 'rider', stars: 5 }),
    /trip read failed/,
  )
})

test('findPendingRating returns the newest unrated trip and swallows a trip query error', async () => {
  assert.equal(await findPendingRating(null, 'me'), null)
  assert.equal(await findPendingRating(fakeSupabase(), ''), null)

  const pending = { id: 't3', status: 'completed', rider_id: 'rider', driver_id: 'me', pickup_label: 'Cooper' }
  const client = fakeSupabase({
    tables: {
      trips: [{
        data: [
          { id: 't1', status: 'completed', rider_id: 'me', driver_id: 'me' },
          { id: 't2', status: 'completed', rider_id: 'me', driver_id: 'd1' },
          pending,
          { id: 't4', status: 'completed', rider_id: 'me', driver_id: 'd2' },
        ],
        error: null,
      }],
      ratings: [
        { data: { id: 'already' }, error: null },
        { data: null, error: null },
      ],
    },
  })
  assert.deepEqual(await findPendingRating(client, 'me'), pending)
  assert.equal(client.calls.find((call) => call.op === 'or').filter, 'rider_id.eq.me,driver_id.eq.me')
  assert.deepEqual(client.calls.find((call) => call.op === 'not'), {
    op: 'not',
    table: 'trips',
    col: 'driver_id',
    operator: 'is',
    val: null,
  })
  assert.deepEqual(client.calls.find((call) => call.op === 'order'), {
    op: 'order',
    table: 'trips',
    col: 'completed_at',
    opts: { ascending: false },
  })
  // BUG?: only the five newest completed trips are requested, so an older unrated trip never prompts.
  assert.equal(client.calls.find((call) => call.op === 'limit').n, 5)
  assert.equal(client.calls.filter((call) => call.op === 'from' && call.table === 'ratings').length, 2)

  const injected = fakeSupabase({
    tables: { trips: [{ data: [], error: null }] },
  })
  await findPendingRating(injected, 'user-1,status.eq.completed')
  // BUG?: userId is interpolated into the PostgREST or() filter without quoting.
  assert.equal(
    injected.calls.find((call) => call.op === 'or').filter,
    'rider_id.eq.user-1,status.eq.completed,driver_id.eq.user-1,status.eq.completed',
  )

  const down = fakeSupabase({
    tables: { trips: [{ data: null, error: { message: 'db down' } }] },
  })
  // BUG?: a trips query error is swallowed and reported as no pending rating.
  assert.equal(await findPendingRating(down, 'me'), null)

  const ratedOut = fakeSupabase({
    tables: {
      trips: [{ data: null, error: null }],
    },
  })
  assert.equal(await findPendingRating(ratedOut, 'me'), null)

  const locked = fakeSupabase({
    tables: {
      trips: [{ data: [{ id: 't1', rider_id: 'me', driver_id: 'd1' }], error: null }],
      ratings: [{ data: null, error: { message: 'connection reset' } }],
    },
  })
  await assert.rejects(() => findPendingRating(locked, 'me'), /connection reset/)
})
