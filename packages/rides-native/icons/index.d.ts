import type { ComponentType, ReactNode } from 'react'
import type { PressableProps, StyleProp, ViewStyle } from 'react-native'
import type { GLYPHS as G } from './glyphs.js'

export type IconName = keyof typeof G
export type IconScheme = 'light' | 'dark'
export type IconProps = {
  name: IconName | (string & {})
  size?: number
  color?: string
  active?: boolean
  scheme?: IconScheme
  knockout?: string
  strokeWidth?: number
  style?: StyleProp<ViewStyle>
  accessibilityLabel?: string
}
export declare const GLYPHS: typeof G
export declare const ICON_NAMES: readonly IconName[]
export declare const ICON_TOKENS: Record<IconScheme, Record<string, string>>
export declare const ION_ALIASES: Readonly<Record<string, IconName>>
export declare const SPRING: { damping: number; stiffness: number; mass: number }
export declare function resolveIconName(name: string): IconName
export declare const Glyph: ComponentType<IconProps>
export declare const Icon: ComponentType<IconProps & { animated?: boolean }>
export declare const GlassBadge: ComponentType<{
  name: IconName | (string & {})
  size?: number
  iconSize?: number
  tone?: 'orange' | 'purple' | 'neutral'
  scheme?: IconScheme
  active?: boolean
  color?: string
  style?: StyleProp<ViewStyle>
}>
export declare const PressScale: ComponentType<PressableProps & { style?: StyleProp<ViewStyle>; scaleTo?: number; children?: ReactNode }>
export type GlassTab = { id: string; label: string; icon: IconName | (string & {}) }
export declare const GlassTabBar: ComponentType<{
  tabs: GlassTab[]
  activeIndex: number
  onSelect: (tab: GlassTab, index: number) => void
  scheme?: IconScheme
  bottomInset?: number
  accent?: string
}>
export type GlyphLayer = { kind: 'wash' | 'fill' | 'specular' | 'stroke' | 'knock' | 'accent'; d: string; fill?: string; stroke?: string; strokeWidth?: number; opacity?: number; gradient?: [string, string, string] }
export declare function opticalStroke(size?: number): number
export declare function glyphLayers(name: string, opts?: { active?: boolean; scheme?: IconScheme; color?: string; knockout?: string; size?: number; strokeWidth?: number }): GlyphLayer[]
export declare function glyphSvg(name: string, opts?: { active?: boolean; scheme?: IconScheme; color?: string; knockout?: string; size?: number; strokeWidth?: number }): string
