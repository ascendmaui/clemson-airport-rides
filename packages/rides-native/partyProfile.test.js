import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildEnsureProfilePatch,
  counterpartId,
  formatRatingLine,
  isProfileComplete,
  missingProfileFields,
  profileFieldError,
  profileRowFromUser,
  ratingBlockReason,
  readSignupDraft,
  shouldLeaveProfileSetup,
  shouldRedirectToProfileSetup,
  signupProfileMetadata,
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
