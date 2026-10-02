/**
 * Form accessibility and validation helpers.
 * Provides accessible ARIA descriptors, invalid states, error IDs, and validation logic.
 */

/**
 * Builds standard accessible ARIA attributes for form inputs.
 *
 * @param {Object} options
 * @param {string} options.id - HTML element id
 * @param {string|null} [options.error] - Current validation error message for this field
 * @param {string|string[]} [options.describedBy] - Additional ID(s) of elements describing this field
 * @param {boolean} [options.required=false] - Whether the field is mandatory
 * @param {boolean} [options.invalid] - Explicit override for invalid state
 * @returns {Object} Props object to spread onto an <input>, <select>, or <textarea>
 */
export function buildFieldA11yProps({
  id,
  error = null,
  describedBy,
  required = false,
  invalid,
} = {}) {
  const isInvalid = invalid !== undefined ? Boolean(invalid) : Boolean(error)
  const errorId = error && id ? `${id}-error` : null

  const descriptions = []
  if (Array.isArray(describedBy)) {
    descriptions.push(...describedBy.filter(Boolean))
  } else if (describedBy && typeof describedBy === 'string') {
    descriptions.push(describedBy.trim())
  }
  if (errorId && !descriptions.includes(errorId)) {
    descriptions.push(errorId)
  }

  const describedByStr = descriptions.join(' ').trim()

  return {
    id,
    'aria-invalid': isInvalid ? 'true' : undefined,
    'aria-required': required ? 'true' : undefined,
    'aria-describedby': describedByStr || undefined,
    'aria-errormessage': errorId || undefined,
  }
}

/**
 * Returns attributes to apply to a field-level error message container.
 *
 * @param {string} fieldId - ID of the input field
 * @returns {Object} Attributes including id, role, aria-live, and className
 */
export function getFieldErrorProps(fieldId) {
  return {
    id: `${fieldId}-error`,
    role: 'alert',
    'aria-live': 'polite',
    className: 'field-error-text',
  }
}

/**
 * Validates a required field.
 */
export function validateRequired(value, fieldLabel = 'This field') {
  if (!String(value ?? '').trim()) {
    return `${fieldLabel} is required.`
  }
  return null
}

/**
 * Validates an email address.
 */
export function validateEmail(email) {
  const trimmed = String(email ?? '').trim()
  if (!trimmed) {
    return 'Email address is required.'
  }
  // Standard permissive email pattern
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(trimmed)) {
    return 'Enter a valid email address (e.g. name@clemson.edu).'
  }
  return null
}

/**
 * Validates a mobile phone number.
 */
export function validatePhone(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '')
  if (!digits) {
    return 'Mobile number is required.'
  }
  if (digits.length < 10) {
    return 'Mobile number must have at least 10 digits.'
  }
  return null
}

/**
 * Validates a password with a minimum length.
 */
export function validatePassword(password, minLength = 6) {
  const str = String(password ?? '')
  if (!str) {
    return 'Password is required.'
  }
  if (str.length < minLength) {
    return `Password must be at least ${minLength} characters.`
  }
  return null
}

/**
 * Summarizes an errors object into a readable message for screen reader announcements.
 *
 * @param {Record<string, string>|string[]} errors
 * @returns {string|null}
 */
export function formatAccessibleFormErrorSummary(errors) {
  if (!errors) return null
  const list = Array.isArray(errors)
    ? errors.filter(Boolean)
    : Object.values(errors).filter(Boolean)
  if (list.length === 0) return null
  if (list.length === 1) return list[0]
  return `Please correct ${list.length} errors: ${list.join('; ')}`
}
