import { missingProfileFields } from '../../packages/rides-native/partyProfile.js'
import { validateEmail, validatePassword } from './formA11y.js'

/** Inline messages for #/sign-up. Empty object means the form can submit. */
export function signupFieldErrors({ fullName, phone, bio, rideStyle, email, password } = {}) {
  const errors = {}
  const missing = missingProfileFields({
    full_name: fullName,
    phone,
    bio,
    ride_style: rideStyle,
  })
  if (missing.includes('full_name')) errors.fullName = 'Full name is required (minimum 2 characters).'
  if (missing.includes('phone')) errors.phone = 'Valid 10-digit mobile number is required.'
  if (missing.includes('bio')) errors.bio = 'Bio must be at least 8 characters.'
  if (missing.includes('ride_style')) errors.rideStyle = 'Please choose a ride style.'
  const emailError = validateEmail(email)
  if (emailError) errors.email = emailError
  const passwordError = validatePassword(password)
  if (passwordError) errors.password = passwordError
  return errors
}
