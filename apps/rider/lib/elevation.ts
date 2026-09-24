import type { ViewStyle } from 'react-native'
import type { Palette } from '@/lib/palette'

export function lift(colors: Palette, level: 'rest' | 'float' | 'bar' = 'rest'): ViewStyle {
  switch (level) {
    case 'float':
      return {
        shadowColor: colors.shadow,
        shadowOpacity: 0.14,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 10 },
        elevation: 6,
      }
    case 'bar':
      return {
        shadowColor: colors.shadow,
        shadowOpacity: 0.08,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: -4 },
        elevation: 8,
      }
    case 'rest':
      return {
        shadowColor: colors.shadow,
        shadowOpacity: 0.08,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
        elevation: 3,
      }
    default: {
      const unknown: never = level
      return unknown
    }
  }
}
