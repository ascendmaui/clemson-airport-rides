/**
 * Touch target sizing and tap spacing utilities.
 * Enforces WCAG 2.1 SC 2.5.5 / WCAG 2.2 SC 2.5.8 and Apple HIG 44x44px minimum touch targets.
 */

export const TOUCH_TARGET_MIN_PX = 44
export const TOUCH_TARGET_SPACING_MIN_PX = 8

/**
 * Checks if dimensions satisfy the 44x44px minimum touch target standard.
 *
 * @param {number} widthPx
 * @param {number} heightPx
 * @returns {boolean}
 */
export function isTouchTargetAccessible(widthPx, heightPx) {
  const w = Number(widthPx) || 0
  const h = Number(heightPx) || 0
  return w >= TOUCH_TARGET_MIN_PX && h >= TOUCH_TARGET_MIN_PX
}

/**
 * Validates that spacing between adjacent interactive elements meets minimum tap clearance.
 *
 * @param {number} spacingPx
 * @returns {boolean}
 */
export function isTapSpacingAccessible(spacingPx) {
  const s = Number(spacingPx) || 0
  return s >= TOUCH_TARGET_SPACING_MIN_PX
}

/**
 * Returns style props ensuring minimum 44x44px dimensions while preserving existing styles.
 *
 * @param {Object} [style={}]
 * @returns {Object}
 */
export function enforceTouchTarget(style = {}) {
  const w = Number(style.width) || Number(style.minWidth) || 0
  const h = Number(style.height) || Number(style.minHeight) || 0

  return {
    ...style,
    minWidth: Math.max(w, TOUCH_TARGET_MIN_PX),
    minHeight: Math.max(h, TOUCH_TARGET_MIN_PX),
  }
}

/**
 * Returns attributes for an accessible navigation or action icon button.
 *
 * @param {Object} options
 * @param {string} options.label - Accessible label describing the button action
 * @param {Object} [options.style={}] - Additional custom styles
 * @returns {Object} Props to spread on an interactive <button>
 */
export function getTouchButtonProps({ label, style = {} } = {}) {
  return {
    'aria-label': label,
    style: enforceTouchTarget(style),
  }
}
