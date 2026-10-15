/**
 * Liquid-glass recipes shared by the rider and driver apps.
 * Plates are milky enough that label contrast stays WCAG AA (4.5:1)
 * over white, black, and both map field colors.
 */

export const GLASS_ORANGE = '#F56600'
export const GLASS_PURPLE = '#522D80'
export const GLASS_GREEN = '#1F8A4C'
export const GLASS_INK = '#16121F'
export const GLASS_LIGHT_TEXT = '#F4F2F8'
export const GLASS_AA = 4.5

export const GLASS_PRESS = Object.freeze({
  scale: 0.96,
  opacityDip: 0.12,
  durationMs: 120,
  disabledOpacity: 0.55,
})

const BACKDROPS = Object.freeze({
  white: '#FFFFFF',
  black: '#000000',
  lightMap: '#F7F4F0',
  darkMap: '#0E0B14',
})

const VARIANTS = ['primary', 'secondary', 'chip', 'fab', 'surface', 'sheet', 'header', 'ghost', 'offer']

/** Offer sheets sit on a map. The plate stays nearly opaque so fare text does not show the map. */
export const OFFER_PLATE_ALPHA = 0.98
const APPS = ['rider', 'driver']
const SCHEMES = ['light', 'dark']

function channel(value) {
  const s = value / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16)
  const r = channel((n >> 16) & 255)
  const g = channel((n >> 8) & 255)
  const b = channel(n & 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(foreground, background) {
  const a = luminance(foreground)
  const b = luminance(background)
  const hi = Math.max(a, b)
  const lo = Math.min(a, b)
  return (hi + 0.05) / (lo + 0.05)
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex(rgb) {
  return `#${rgb.map((part) => Math.max(0, Math.min(255, Math.round(part))).toString(16).padStart(2, '0')).join('')}`
}

/** Composite an rgba plate over an opaque backdrop. */
export function compositePlate(plate, backdropHex) {
  const back = hexToRgb(backdropHex)
  const alpha = plate.alpha
  return rgbToHex([
    back[0] * (1 - alpha) + plate.rgb[0] * alpha,
    back[1] * (1 - alpha) + plate.rgb[1] * alpha,
    back[2] * (1 - alpha) + plate.rgb[2] * alpha,
  ])
}

export function worstContrast(text, plate) {
  let worst = Infinity
  for (const backdrop of Object.values(BACKDROPS)) {
    const ratio = contrastRatio(text, compositePlate(plate, backdrop))
    if (ratio < worst) worst = ratio
  }
  return worst
}

function plate(rgb, alpha) {
  return { rgb, alpha }
}

function recipe(partial) {
  return {
    tint: partial.tint,
    accent: partial.accent,
    text: partial.text,
    plate: partial.plate,
    radius: partial.radius,
    blur: partial.blur,
    specular: partial.specular,
    streak: partial.streak,
    borderTop: partial.borderTop,
    borderSide: partial.borderSide,
    borderBottom: partial.borderBottom,
  }
}

const LIGHT_EDGE = {
  borderTop: 'rgba(255,255,255,0.96)',
  borderSide: 'rgba(255,255,255,0.62)',
  borderBottom: 'rgba(255,255,255,0.34)',
  specular: 0.62,
  streak: 0.72,
}

const DARK_EDGE = {
  borderTop: 'rgba(255,255,255,0.42)',
  borderSide: 'rgba(255,255,255,0.16)',
  borderBottom: 'rgba(255,255,255,0.08)',
  specular: 0.28,
  streak: 0.5,
}

/**
 * @param {{ app?: 'rider' | 'driver', scheme?: 'light' | 'dark', variant?: string, accent?: 'orange' | 'purple' | 'green' }} [opts]
 */
export function glassRecipe(opts = {}) {
  const app = opts.app === 'driver' ? 'driver' : 'rider'
  const scheme = opts.scheme === 'dark' ? 'dark' : 'light'
  const variant = VARIANTS.includes(opts.variant) ? opts.variant : 'surface'
  const accent = opts.accent === 'purple' || opts.accent === 'orange' || opts.accent === 'green'
    ? opts.accent
    : (app === 'driver' ? 'purple' : 'orange')
  const dark = scheme === 'dark'
  const edge = dark ? DARK_EDGE : LIGHT_EDGE
  const tint = accent === 'purple' ? GLASS_PURPLE : accent === 'green' ? GLASS_GREEN : GLASS_ORANGE
  const body = pickPlate(app, scheme, variant, accent)
  return recipe({
    tint,
    accent,
    text: body.text,
    plate: body.plate,
    radius: radiusFor(variant),
    blur: variant === 'sheet' || variant === 'header' ? 64 : variant === 'primary' || variant === 'fab' ? 36 : 48,
    ...edge,
  })
}

function radiusFor(variant) {
  switch (variant) {
    case 'chip':
    case 'fab':
      return 999
    case 'sheet':
      return 28
    case 'header':
    case 'secondary':
    case 'surface':
    case 'offer':
      return 22
    case 'primary':
    case 'ghost':
      return 18
    default: {
      const unknown = variant
      throw new Error(`Unknown glass variant ${String(unknown)}`)
    }
  }
}

function pickPlate(app, scheme, variant, accent) {
  const dark = scheme === 'dark'
  const strong = variant === 'primary' || variant === 'fab'
  if (strong && accent === 'green') {
    return dark
      ? { text: '#F3FFF6', plate: plate([8, 64, 36], 0.94) }
      : { text: '#F3FFF6', plate: plate([14, 104, 56], 0.94) }
  }
  if (!dark && strong && accent === 'orange') {
    return { text: '#1A1008', plate: plate([236, 98, 8], 0.94) }
  }
  if (!dark && strong && accent !== 'orange') {
    return { text: '#FFFFFF', plate: plate([82, 45, 128], 0.94) }
  }
  if (dark && strong && accent === 'orange') {
    return { text: '#FFF7F2', plate: plate([92, 34, 0], 0.94) }
  }
  if (dark && strong && accent !== 'orange') {
    return { text: '#F4F2F8', plate: plate([46, 22, 78], 0.94) }
  }
  if (variant === 'offer') {
    return dark
      ? { text: GLASS_LIGHT_TEXT, plate: plate([16, 12, 24], OFFER_PLATE_ALPHA) }
      : { text: GLASS_INK, plate: plate([255, 252, 248], OFFER_PLATE_ALPHA) }
  }
  if (!dark && app === 'rider') {
    return { text: GLASS_INK, plate: plate([255, 236, 222], variant === 'chip' ? 0.9 : 0.88) }
  }
  if (!dark) {
    return { text: GLASS_INK, plate: plate([244, 236, 252], variant === 'chip' ? 0.9 : 0.88) }
  }
  if (app === 'rider') {
    return { text: GLASS_LIGHT_TEXT, plate: plate([36, 18, 14], 0.9) }
  }
  return { text: GLASS_LIGHT_TEXT, plate: plate([28, 18, 42], 0.9) }
}

export function glassFill(recipeValue) {
  const [r, g, b] = recipeValue.plate.rgb
  const alpha = recipeValue.plate.alpha
  return `rgba(${r},${g},${b},${alpha})`
}

export function glassTextColor(opts) {
  return glassRecipe(opts).text
}

/** Every app, scheme, and variant, including driver orange accents. */
export function glassCatalog() {
  const rows = []
  for (const app of APPS) {
    for (const scheme of SCHEMES) {
      for (const variant of VARIANTS) {
        rows.push({ app, scheme, variant, accent: app === 'driver' ? 'purple' : 'orange', recipe: glassRecipe({ app, scheme, variant }) })
        if (app === 'driver' && (variant === 'primary' || variant === 'fab' || variant === 'chip')) {
          rows.push({ app, scheme, variant, accent: 'orange', recipe: glassRecipe({ app, scheme, variant, accent: 'orange' }) })
        }
      }
    }
  }
  return rows
}

export function glassContrastFailures() {
  return glassCatalog().flatMap((row) => {
    const ratio = worstContrast(row.recipe.text, row.recipe.plate)
    if (ratio >= GLASS_AA) return []
    return [{ ...row, ratio, recipe: undefined, text: row.recipe.text }]
  })
}

export const GLASS_LAYERS = Object.freeze(['shadow', 'blur', 'tint', 'specular', 'streak', 'border'])

/** Orange primary, fab, and chip buttons skip the diagonal streak. Other glass keeps it. */
export function glassShowsStreak({ variant, accent } = {}) {
  if (accent === 'orange' && (variant === 'primary' || variant === 'fab' || variant === 'chip')) return false
  return true
}
