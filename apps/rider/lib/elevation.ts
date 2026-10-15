import type { ViewStyle } from 'react-native'
// Relative path so `npm test` can load these tokens without the Metro alias.
import { elevationFor } from '../../../packages/rides-native/shared/theme.js'
import { darkPalette, type Palette } from '@/lib/palette'

function schemeFor(colors: Palette): 'light' | 'dark' {
  return colors.background === darkPalette.background ? 'dark' : 'light'
}

export function lift(colors: Palette, level: 'rest' | 'float' | 'bar' = 'rest'): ViewStyle {
  const recipe = elevationFor(level, schemeFor(colors))
  switch (level) {
    case 'float':
    case 'bar':
    case 'rest':
      return {
        shadowColor: colors.shadow,
        shadowOpacity: recipe.shadowOpacity,
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
