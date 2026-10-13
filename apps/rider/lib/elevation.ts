import type { ViewStyle } from 'react-native'
import { elevationFor } from 'rides-native/shared/theme.js'
import type { Palette } from '@/lib/palette'

export function lift(colors: Palette, level: 'rest' | 'float' | 'bar' = 'rest'): ViewStyle {
  const recipe = elevationFor(level, 'light')
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
