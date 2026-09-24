import { useMemo } from 'react'
import { StyleSheet, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'

type NamedStyles = Record<string, ViewStyle | TextStyle | ImageStyle>

export function useThemedStyles<T extends NamedStyles>(factory: (colors: Palette) => T): T {
  const { colors } = useTheme()
  return useMemo(() => StyleSheet.create(factory(colors)) as T, [colors, factory])
}
