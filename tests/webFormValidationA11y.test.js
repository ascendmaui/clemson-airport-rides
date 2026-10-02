import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'
import {
  buildFieldA11yProps,
  getFieldErrorProps,
  validateRequired,
  validateEmail,
  validatePhone,
  validatePassword,
  formatAccessibleFormErrorSummary,
} from '../src/lib/formA11y.js'

const __filename = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(__filename), '..')

function readSource(relPath) {
  return readFileSync(path.join(ROOT, relPath), 'utf8')
}

test('formA11y: buildFieldA11yProps generates standard ARIA accessibility attributes', () => {
  // Valid, pristine field
  const validProps = buildFieldA11yProps({
    id: 'user-email',
    required: true,
  })
  assert.equal(validProps.id, 'user-email')
  assert.equal(validProps['aria-required'], 'true')
  assert.equal(validProps['aria-invalid'], undefined)
  assert.equal(validProps['aria-describedby'], undefined)
  assert.equal(validProps['aria-errormessage'], undefined)

  // Field with error
  const invalidProps = buildFieldA11yProps({
    id: 'user-email',
    error: 'Email address is required.',
    required: true,
  })
  assert.equal(invalidProps['aria-invalid'], 'true')
  assert.equal(invalidProps['aria-describedby'], 'user-email-error')
  assert.equal(invalidProps['aria-errormessage'], 'user-email-error')

  // Field with existing description hint and error
  const hintAndErrorProps = buildFieldA11yProps({
    id: 'user-phone',
    describedBy: 'phone-hint',
    error: 'Enter a valid 10-digit number.',
  })
  assert.equal(hintAndErrorProps['aria-invalid'], 'true')
  assert.equal(hintAndErrorProps['aria-describedby'], 'phone-hint user-phone-error')

  // Array of describedBy IDs
  const multiHintProps = buildFieldA11yProps({
    id: 'user-bio',
    describedBy: ['bio-hint', 'bio-char-count'],
  })
  assert.equal(multiHintProps['aria-describedby'], 'bio-hint bio-char-count')
})

test('formA11y: getFieldErrorProps returns accessible container attributes', () => {
  const errorProps = getFieldErrorProps('signup-phone')
  assert.equal(errorProps.id, 'signup-phone-error')
  assert.equal(errorProps.role, 'alert')
  assert.equal(errorProps['aria-live'], 'polite')
  assert.equal(errorProps.className, 'field-error-text')
})

test('formA11y: validation helpers return clear, accessible messages', () => {
  // Required
  assert.equal(validateRequired('', 'Full name'), 'Full name is required.')
  assert.equal(validateRequired('  '), 'This field is required.')
  assert.equal(validateRequired('John'), null)

  // Email
  assert.equal(validateEmail(''), 'Email address is required.')
  assert.equal(validateEmail('not-an-email'), 'Enter a valid email address (e.g. name@clemson.edu).')
  assert.equal(validateEmail('rider@clemson.edu'), null)

  // Phone
  assert.equal(validatePhone(''), 'Mobile number is required.')
  assert.equal(validatePhone('12345'), 'Mobile number must have at least 10 digits.')
  assert.equal(validatePhone('(864) 555-0199'), null)

  // Password
  assert.equal(validatePassword(''), 'Password is required.')
  assert.equal(validatePassword('12345', 6), 'Password must be at least 6 characters.')
  assert.equal(validatePassword('clemson123', 6), null)

  // Summary
  assert.equal(formatAccessibleFormErrorSummary(null), null)
  assert.equal(formatAccessibleFormErrorSummary([]), null)
  assert.equal(formatAccessibleFormErrorSummary(['Field is required']), 'Field is required')
  assert.match(
    formatAccessibleFormErrorSummary({
      email: 'Email is required',
      phone: 'Phone must have 10 digits',
    }),
    /Please correct 2 errors: Email is required; Phone must have 10 digits/,
  )
})

test('index.css includes accessible styles for invalid fields and error summaries', () => {
  const css = readSource('src/index.css')

  assert.match(css, /input\[aria-invalid="true"\]/, 'contains input[aria-invalid="true"]')
  assert.match(css, /border-color:\s*var\(--danger\)/, 'highlights invalid inputs with danger border')
  assert.match(css, /input\[aria-invalid="true"\]:focus-visible/, 'provides high-contrast focus ring on invalid inputs')
  assert.match(css, /\.field-error-text\s*\{/, 'contains .field-error-text rule')
  assert.match(css, /\.form-summary-alert\s*\{/, 'contains .form-summary-alert rule')
})

test('AuthScreens.jsx wires accessible labels, field errors, and ARIA alerts', () => {
  const code = readSource('src/screens/AuthScreens.jsx')

  // Babel JSX parse check
  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['jsx'],
  })
  assert.ok(ast, 'AuthScreens parses cleanly')

  // SignInScreen accessibility checks
  assert.match(code, /htmlFor="signin-email"/, 'SignIn connects email label')
  assert.match(code, /id="signin-email"/, 'SignIn email input has matching ID')
  assert.match(code, /htmlFor="signin-password"/, 'SignIn connects password label')
  assert.match(code, /id="signin-password"/, 'SignIn password input has matching ID')
  assert.match(code, /id="signin-form-alert"/, 'SignIn exposes alert container ID')
  assert.match(code, /role="alert"/, 'SignIn specifies alert role')
  assert.match(code, /aria-live="polite"/, 'SignIn marks error with polite live region')

  // SignUpScreen accessibility checks
  assert.match(code, /htmlFor="signup-fullname"/, 'SignUp connects fullname label')
  assert.match(code, /id="signup-fullname"/, 'SignUp fullname input has ID')
  assert.match(code, /htmlFor="signup-phone"/, 'SignUp connects phone label')
  assert.match(code, /id="signup-phone"/, 'SignUp phone input has ID')
  assert.match(code, /htmlFor="signup-bio"/, 'SignUp connects bio label')
  assert.match(code, /id="signup-bio"/, 'SignUp bio input has ID')
  assert.match(code, /htmlFor="signup-email"/, 'SignUp connects email label')
  assert.match(code, /id="signup-email"/, 'SignUp email input has ID')
  assert.match(code, /htmlFor="signup-promo"/, 'SignUp connects promo label')
  assert.match(code, /id="signup-promo"/, 'SignUp promo input has ID')

  // Hints and field error ARIA connections
  assert.match(code, /id="signup-email-hint"/, 'SignUp provides email hint ID')
  assert.match(code, /id="signup-promo-hint"/, 'SignUp provides promo hint ID')
  assert.match(code, /aria-invalid=\{showValidation && missingFields\.includes\('full_name'\)/, 'SignUp flags invalid fullname')
  assert.match(code, /aria-invalid=\{showValidation && missingFields\.includes\('phone'\)/, 'SignUp flags invalid phone')
  assert.match(code, /aria-invalid=\{showValidation && missingFields\.includes\('bio'\)/, 'SignUp flags invalid bio')
  assert.match(code, /id="signup-fullname-error"/, 'SignUp provides fullname error message container')
  assert.match(code, /id="signup-phone-error"/, 'SignUp provides phone error message container')
  assert.match(code, /id="signup-bio-error"/, 'SignUp provides bio error message container')

  // Radio / button group accessibility
  assert.match(code, /role="group"/, 'SignUp ride style container uses role="group"')
  assert.match(code, /aria-labelledby="signup-ridestyle-label"/, 'SignUp ride style container is labelled')
  assert.match(code, /aria-pressed=\{on\}/, 'SignUp ride style buttons announce toggle state')

  // Global alerts
  assert.match(code, /id="signup-form-alert"/, 'SignUp provides global form alert ID')
  assert.match(code, /role="status"/, 'SignUp provides polite status announcements')
})

test('ScheduleAirport.jsx connects accessible form inputs and error alerts', () => {
  const code = readSource('src/screens/ScheduleAirport.jsx')

  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['jsx'],
  })
  assert.ok(ast, 'ScheduleAirport parses cleanly')

  assert.match(code, /htmlFor="schedule-flight-date"/, 'ScheduleAirport connects date label')
  assert.match(code, /id="schedule-flight-date"/, 'ScheduleAirport date input has matching ID')
  assert.match(code, /htmlFor="schedule-flight-time"/, 'ScheduleAirport connects time label')
  assert.match(code, /id="schedule-flight-time"/, 'ScheduleAirport time input has matching ID')
  assert.match(code, /id="schedule-airport-error"/, 'ScheduleAirport error message has ID')
  assert.match(code, /aria-describedby=\{error \? 'schedule-airport-error' : undefined\}/, 'ScheduleAirport inputs link to error alert')
})

test('AccountScreenImpl.jsx student verification note provides polite live region', () => {
  const code = readSource('src/screens/AccountScreenImpl.jsx')

  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['jsx'],
  })
  assert.ok(ast, 'AccountScreenImpl parses cleanly')

  assert.match(code, /id="student-verification-note"/, 'AccountScreenImpl provides student verification note ID')
  assert.match(code, /role="status"/, 'AccountScreenImpl student verification note has role="status"')
  assert.match(code, /aria-live="polite"/, 'AccountScreenImpl student verification note has aria-live="polite"')
})
