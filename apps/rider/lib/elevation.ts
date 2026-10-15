import type { ViewStyle } from 'react-native'
// Relative path so `npm test` can load these tokens without the Metro alias.
import { elevationFor } from '../../../packages/rides-native/shared/theme.js'
import { darkPalette, type Palette } from './palette.ts'

function shadowScheme(colors: Palette): 'light' | 'dark' {
  return colors.background === darkPalette.background ? 'dark' : 'light'
}

export function lift(colors: Palette, level: 'rest' | 'float' | 'bar' = 'rest'): ViewStyle {
  const scheme = shadowScheme(colors)
  const recipe = elevationFor(level, scheme)
  const nightOpacity = elevationFor('rest', 'dark').shadowOpacity
  const shadowOpacity = scheme === 'dark' ? Math.max(recipe.shadowOpacity, nightOpacity) : recipe.shadowOpacity
  switch (level) {
    case 'float':
    case 'bar':
    case 'rest':
      return {
        shadowColor: colors.shadow,
        shadowOpacity,
        shadowRadius: recipe.shadowRadius,
        shadowOffset: { width: recipe.shadowOffset.width, height: recipe.shadowOffset.height },
        elevation: recipe.elevation,
      }
    default: {
      const unknown: never = level
      return unknown
    }
  }
}
