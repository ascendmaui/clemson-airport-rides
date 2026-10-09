/**
 * Color tokens and WCAG contrast calculation utilities.
 * Ensures all UI elements and badge readability tokens meet or exceed WCAG AA standards.
 */

export const CLEMSON_TOKENS = {
  orange: '#F56600',
  orangeText: '#BA4700', // WCAG AA compliant on light background (5.2:1)
  orangeDark: '#963800', // WCAG AAA compliant on light background (7.3:1)
  purple: '#522D80',
  purpleText: '#522D80', // WCAG AAA compliant on white (9.4:1)
  ink: '#0B1220',
  inkSecondary: '#5B6472',
  inkTertiary: '#596372', // High-contrast tertiary (4.6:1 on white)
  surface: '#FFFFFF',
  surfaceMuted: '#F4F5F8',
  success: '#1F8A4C',
  successText: '#156938', // High-contrast success (4.8:1 on white)
  danger: '#D92D20',
  dangerText: '#B42318', // High-contrast danger (5.0:1 on white)
}

export const BADGE_VARIANTS = {
  purple: {
    bg: 'var(--badge-purple-bg)',
    border: 'var(--badge-purple-border)',
    color: 'var(--badge-purple-text)',
    textHex: CLEMSON_TOKENS.purpleText,
    bgHex: '#EAE5F0', // Approx light purple blend on white
  },
  orange: {
    bg: 'var(--badge-orange-bg)',
    border: 'var(--badge-orange-border)',
    color: 'var(--badge-orange-text)',
    textHex: CLEMSON_TOKENS.orangeText,
    bgHex: '#FEEFE6', // Approx light orange blend on white
  },
  success: {
    bg: 'var(--badge-success-bg)',
    border: 'var(--badge-success-border)',
    color: 'var(--badge-success-text)',
    textHex: CLEMSON_TOKENS.successText,
    bgHex: '#E9F5EE',
  },
  danger: {
    bg: 'var(--badge-danger-bg)',
    border: 'var(--badge-danger-border)',
    color: 'var(--badge-danger-text)',
    textHex: CLEMSON_TOKENS.dangerText,
    bgHex: '#FDEEEB',
  },
  neutral: {
    bg: 'var(--badge-neutral-bg)',
    border: 'var(--badge-neutral-border)',
    color: 'var(--badge-neutral-text)',
    textHex: '#344054',
    bgHex: '#F2F4F7',
  },
  fleet: {
    bg: 'var(--badge-fleet-bg)',
    border: 'var(--badge-fleet-border)',
    color: 'var(--badge-fleet-text)',
    textHex: CLEMSON_TOKENS.purpleText,
    bgHex: '#ECE7F2',
  },
}

/**
 * Converts a hex color string to sRGB components [r, g, b] (0-255).
 */
export function hexToRgb(hex) {
  const clean = String(hex || '').replace('#', '').trim()
  if (clean.length === 3) {
    return [
      parseInt(clean[0] + clean[0], 16),
      parseInt(clean[1] + clean[1], 16),
      parseInt(clean[2] + clean[2], 16),
    ]
  }
  if (clean.length === 6) {
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16),
    ]
  }
  return [0, 0, 0]
}

/**
 * Computes WCAG relative luminance for an sRGB component.
 */
function srgbLuminance(channel) {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/**
 * Computes the relative luminance of a color per WCAG 2.1 specs.
 *
 * @param {string} hex
 * @returns {number} Relative luminance in [0, 1]
 */
export function getRelativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex)
  return 0.2126 * srgbLuminance(r) + 0.7152 * srgbLuminance(g) + 0.0722 * srgbLuminance(b)
}

/**
 * Computes the WCAG contrast ratio between two hex colors.
 *
 * @param {string} hex1
 * @param {string} hex2
 * @returns {number} Contrast ratio between 1 and 21 (rounded to 2 decimal places)
 */
export function getContrastRatio(hex1, hex2) {
  const l1 = getRelativeLuminance(hex1)
  const l2 = getRelativeLuminance(hex2)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  const ratio = (lighter + 0.05) / (darker + 0.05)
  return Math.round(ratio * 100) / 100
}

/**
 * Checks if a color combination satisfies WCAG accessibility criteria.
 *
 * @param {string} foregroundHex
 * @param {string} backgroundHex
 * @param {'AA'|'AAA'} [level='AA']
 * @param {boolean} [isLargeText=false]
 * @returns {boolean}
 */
export function isContrastAccessible(foregroundHex, backgroundHex, level = 'AA', isLargeText = false) {
  const ratio = getContrastRatio(foregroundHex, backgroundHex)
  if (level === 'AAA') {
    return isLargeText ? ratio >= 4.5 : ratio >= 7.0
  }
  // Level AA
  return isLargeText ? ratio >= 3.0 : ratio >= 4.5
}
