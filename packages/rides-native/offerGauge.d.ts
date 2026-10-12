export type GaugeTier = 'orange' | 'green' | 'blue' | 'gold' | 'purple' | 'diamond' | 'crown'
export interface GaugeInput { netCents?: number | null; tipCents?: number | null; tipPrepaid?: boolean; pickupMinutes?: number | null; tripMinutes?: number | null }
export const GAUGE_TIERS: ReadonlyArray<{ id: GaugeTier; label: string; min: number; exclusiveMin?: boolean }>
export const GAUGE_FULL_SCALE: number
export function gaugeTier(dollarsPerHour: number): GaugeTier | null
export function gaugeTierLabel(tier: GaugeTier | null): string | null
export function gaugeNetCents(input?: GaugeInput): number
export function effectiveHourly(input?: GaugeInput): number | null
export function formatGauge(dollarsPerHour: number | null | undefined): string
export function gaugeFill(dollarsPerHour: number | null | undefined): number
export interface GaugeEffects { shimmerMs: number; glow: number; sparkles: number; ring: boolean; burst: boolean; haptics: number; crown?: boolean }
export function diamondLevel(dollarsPerHour: number): 1 | 2 | 3 | 4 | 5 | null
export function gaugeEffects(tier: GaugeTier | null, level?: number | null): GaugeEffects
export function offerGauge(input?: GaugeInput): { effects: GaugeEffects; level: number | null; hourly: number | null; text: string; tier: GaugeTier | null; tierLabel: string | null; fill: number; accessibilityLabel: string }
type Swatch = { bg: string; fg: string; accent: string; gradient?: [string, string, string] }
export const GAUGE_PALETTE: Record<GaugeTier, { light: Swatch; dark: Swatch }>
export function offerCardGauge(card: unknown, driver?: { lat: number; lng: number } | null): ReturnType<typeof offerGauge>
