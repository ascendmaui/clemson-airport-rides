import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { signupFieldErrors } from '../src/lib/signupFields.js'

const complete = {
  fullName: 'Jordan Lee',
  phone: '8645550100',
  bio: 'Quiet rides please',
  rideStyle: 'Quiet',
  email: 'jordan@clemson.edu',
  password: 'secret1',
}

test('signup names empty fields, a short phone, a bad email, and a short password', () => {
  const empty = signupFieldErrors({})
  assert.match(empty.fullName, /Full name is required/)
  assert.match(empty.phone, /10-digit/)
  assert.match(empty.bio, /8 characters/)
  assert.match(empty.rideStyle, /ride style/)
  assert.match(empty.email, /Email address is required/)
  assert.match(empty.password, /Password is required/)

  const invalid = signupFieldErrors({
    ...complete,
    phone: '864',
    email: 'not-an-email',
    password: 'abc',
  })
  assert.match(invalid.phone, /10-digit/)
  assert.match(invalid.email, /valid email/i)
  assert.match(invalid.password, /at least 6/)
  assert.equal(invalid.fullName, undefined)
})

test('a complete signup draft has no field errors', () => {
  assert.deepEqual(signupFieldErrors(complete), {})
})

test('create account stays clickable and the form does not rely on native required', () => {
  const screen = readFileSync(new URL('../src/screens/AuthScreens.jsx', import.meta.url), 'utf8')
  const signup = screen.slice(screen.indexOf('export function SignUpScreen'))
  assert.match(signup, /noValidate/)
  assert.match(signup, /signupFieldErrors/)
  assert.match(signup, /id="signup-email-error"/)
  assert.match(signup, /id="signup-password-error"/)
  assert.doesNotMatch(signup, /disabled=\{blocked \|\| !profileReady\}/)
  assert.doesNotMatch(signup, /\n\s+required\n/)
})
