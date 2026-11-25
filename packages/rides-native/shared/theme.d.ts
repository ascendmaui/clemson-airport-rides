export const ORANGE: string
export const ORANGE_BRIGHT: string
export const PURPLE: string
export const INK: string
export const INK_SECONDARY: string
export const DANGER: string
export const SURFACE: string

export const color: {
  orange: string
  orangeBright: string
  purple: string
  ink: string
  inkSecondary: string
  danger: string
  surface: string
  white: string
  shadow: string
}

export const space: {
  xxs: number
  xs: number
  sm: number
  md: number
  lg: number
  xl: number
  xxl: number
  screen: number
}

export const radius: {
  xs: number
  sm: number
  control: number
  lg: number
  xl: number
  panel: number
  sheet: number
  pill: number
}

type TextRole = {
  fontSize: number
  fontWeight: '400' | '600' | '700' | '800'
  letterSpacing?: number
  lineHeight?: number
}

export const type: {
  kicker: TextRole
  kickerSm: TextRole
  display: TextRole
  title: TextRole
  headline: TextRole
  cardTitle: TextRole
  section: TextRole
  body: TextRole
  button: TextRole
  amount: TextRole
  meta: TextRole
}

type ShadowRecipe = {
  shadowOpacity: number
  shadowRadius: number
  shadowOffset: { width: number; height: number }
  elevation: number
}

export const elevation: {
  rest: ShadowRecipe
  float: ShadowRecipe
  bar: ShadowRecipe
  darkRest: ShadowRecipe
}

export const motion: {
  enterFadeMs: number
  enterRiseMs: number
  enterDistance: number
  pressOpacity: number
  pressScale: number
  disabledOpacity: number
  pressDurationMs: number
}

export type ElevationLevel = 'rest' | 'float' | 'bar'
export type SchemeName = 'light' | 'dark'

export function motionDuration(ms: number, reduceMotion: boolean): number
export function elevationFor(level: ElevationLevel, scheme?: SchemeName): ShadowRecipe
export function shadowStyle(
  shadowColor: string,
  level?: ElevationLevel,
  scheme?: SchemeName,
): ShadowRecipe & { shadowColor: string }

export const glow: { shadowOpacity: number; shadowRadius: number; shadowOffset: { width: number; height: number }; elevation: number }
export function glowStyle(
  glowColor: string,
  platform?: string,
): {
  shadowColor: string
  shadowOpacity: number
  shadowRadius: number
  shadowOffset: { width: number; height: number }
  elevation: number
  borderWidth?: number
  borderColor?: string
}
