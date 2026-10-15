import type { ReactNode } from 'react'
import type { AccessibilityRole, AccessibilityState, StyleProp, ViewStyle } from 'react-native'

export type GlassApp = 'rider' | 'driver'
export type GlassScheme = 'light' | 'dark'
export type GlassVariant = 'primary' | 'secondary' | 'chip' | 'fab' | 'surface' | 'sheet' | 'header' | 'ghost' | 'offer'
export type GlassAccent = 'orange' | 'purple' | 'green'

export type GlassRecipeOptions = {
  app?: GlassApp
  scheme?: GlassScheme
  variant?: GlassVariant
  accent?: GlassAccent
}

export type GlassPlate = { rgb: [number, number, number]; alpha: number }

export type GlassRecipe = {
  tint: string
  accent: GlassAccent
  text: string
  plate: GlassPlate
  radius: number
  blur: number
  specular: number
  streak: number
  borderTop: string
  borderSide: string
  borderBottom: string
}

export declare const GLASS_ORANGE: '#F56600'
export declare const OFFER_PLATE_ALPHA: number
export declare const GLASS_PURPLE: '#522D80'
export declare const GLASS_GREEN: '#1F8A4C'
export declare const GLASS_INK: string
export declare const GLASS_LIGHT_TEXT: string
export declare const GLASS_AA: number
export declare const GLASS_PRESS: { scale: number; opacityDip: number; durationMs: number; disabledOpacity: number }
export declare const GLASS_LAYERS: readonly string[]
export declare function contrastRatio(foreground: string, background: string): number
export declare function compositePlate(plate: GlassPlate, backdropHex: string): string
export declare function worstContrast(text: string, plate: GlassPlate): number
export declare function glassRecipe(opts?: GlassRecipeOptions): GlassRecipe
export declare function glassFill(recipe: GlassRecipe): string
export declare function glassTextColor(opts?: GlassRecipeOptions): string
export declare function glassCatalog(): Array<{ app: GlassApp; scheme: GlassScheme; variant: GlassVariant; accent: GlassAccent; recipe: GlassRecipe }>
export declare function glassContrastFailures(): unknown[]
export declare function glassShowsStreak(opts?: { variant?: GlassVariant; accent?: GlassAccent }): boolean
export declare function nativeGlassAvailable(): boolean

type GlassFrame = {
  children?: ReactNode
  app?: GlassApp
  scheme?: GlassScheme
  accent?: GlassAccent
  style?: StyleProp<ViewStyle>
  accessibilityRole?: AccessibilityRole
  accessibilityLabel?: string
  accessibilityState?: AccessibilityState
  pointerEvents?: 'auto' | 'none' | 'box-none' | 'box-only'
}

export declare function GlassSurface(props: GlassFrame & {
  variant?: GlassVariant
  selected?: boolean
  edges?: 'all' | 'top'
  showStreak?: boolean
}): ReactNode

export declare function GlassSheen(props: {
  scheme?: GlassScheme
  radius?: number
  selected?: boolean
  tint?: string
  specular?: number
  streak?: number
  showStreak?: boolean
  edges?: 'all' | 'top'
}): ReactNode

export declare function GlassButton(props: GlassFrame & {
  label?: string
  onPress?: () => void
  disabled?: boolean
  variant?: 'primary' | 'secondary' | 'chip' | 'fab' | 'ghost'
  selected?: boolean
  showStreak?: boolean
  accessibilityHint?: string
  hitSlop?: number | { top?: number; bottom?: number; left?: number; right?: number }
  onPressIn?: (event: unknown) => void
  onPressOut?: (event: unknown) => void
}): ReactNode

export declare function GlassCard(props: GlassFrame & { selected?: boolean; variant?: 'surface' | 'offer' }): ReactNode
export declare function GlassSheet(props: GlassFrame): ReactNode
