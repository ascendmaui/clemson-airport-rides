import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { paletteFor } from '@/lib/palette'
import { useOptionalTheme } from '@/lib/theme'
import { driverPresence } from '@/lib/presence'
import { radius, type as typeScale } from 'rides-native/shared/theme.js'
import {
  boundaryCaught,
  boundaryRetried,
  initialBoundaryState,
  recoveryCopy,
  rememberedActiveTrip,
  reportCrash,
  requestTripResume,
  type BoundaryState,
  type CrashScope,
} from '@/lib/crashReport'

type Props = {
  children: ReactNode
  scope: CrashScope
  /** Screen title under the eyebrow, e.g. "Your trip". */
  title?: string
  /** Fill the screen (route-level boundaries). */
  fill?: boolean
  /** A small banner instead of a full screen (overlays such as the offer bridge). */
  compact?: boolean
}

function presenceOnline(): boolean {
  try {
    return driverPresence.snapshot().intent === 'online'
  } catch {
    return false
  }
}

/**
 * Clemson Rides recovery screen. It reads no React context (theme, auth) so it
 * still renders when the root providers themselves are what failed.
 */
function Recovery({ scope, title, fill, compact, onRetry }: Omit<Props, 'children'> & { onRetry: () => void }) {
  // Root crash during a trip: offer the trip itself, reopened after the remount.
  const tripId = scope === 'app' ? rememberedActiveTrip() : null
  // Above the ThemeProvider (root boundary) there is no theme; fall back to the light palette.
  const theme = useOptionalTheme()
  const colors = theme?.colors ?? paletteFor('light')
  const copy = recoveryCopy(scope, { online: presenceOnline(), onTrip: Boolean(tripId) })
  const button = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={copy.action}
      accessibilityHint="Reloads this screen. Your online status and trip are kept."
      onPress={onRetry}
      hitSlop={8}
      style={({ pressed }) => ({
        alignSelf: 'flex-start',
        minHeight: 44,
        justifyContent: 'center',
        backgroundColor: colors.purple,
        borderRadius: radius.control,
        paddingVertical: 12,
        paddingHorizontal: 20,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Text style={[typeScale.button, { color: colors.onAccent }]}>{copy.action}</Text>
    </Pressable>
  )
  if (compact) {
    return (
      <View
        accessibilityRole="alert"
        style={{
          margin: 12,
          padding: 14,
          gap: 10,
          borderRadius: radius.lg,
          backgroundColor: colors.card,
          borderLeftWidth: 4,
          borderLeftColor: colors.orange,
        }}
      >
        <Text style={{ color: colors.ink, fontSize: 15, fontWeight: '600' }}>{copy.where} {copy.state}</Text>
        {button}
      </View>
    )
  }
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      style={{
        flex: fill ? 1 : undefined,
        justifyContent: 'center',
        padding: 28,
        gap: 12,
        backgroundColor: colors.background,
      }}
    >
      <View style={{ width: 48, height: 6, borderRadius: 3, backgroundColor: colors.orange }} />
      <Text style={{ color: colors.orange, fontWeight: '800', letterSpacing: 1, fontSize: 12 }}>{copy.eyebrow}</Text>
      <Text style={{ color: colors.title, fontSize: 24, fontWeight: '800' }}>{title || 'Clemson Rides'}</Text>
      <Text style={{ color: colors.inkSecondary, fontSize: 16, lineHeight: 22 }}>{copy.where} {copy.state}</Text>
      {tripId ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to my trip"
          accessibilityHint="Reloads the app and reopens your active trip."
          onPress={() => { requestTripResume(tripId); onRetry() }}
          hitSlop={8}
          style={({ pressed }) => ({
            alignSelf: 'flex-start',
            minHeight: 44,
            justifyContent: 'center',
            backgroundColor: colors.orange,
            borderRadius: radius.control,
            paddingVertical: 12,
            paddingHorizontal: 20,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text style={[typeScale.button, { color: colors.onAccent }]}>Back to my trip</Text>
        </Pressable>
      ) : null}
      {button}
    </View>
  )
}

/**
 * Catches render errors in its subtree, logs them ('[driver-crash]'), and shows
 * a branded Try again screen. Try again remounts the children with a new key.
 * Online status (presence heartbeat), the trip row (server), and saved taps
 * (offline action queue) all live outside React, so recovery keeps them.
 */
export class CrashBoundary extends Component<Props, BoundaryState> {
  state: BoundaryState = initialBoundaryState

  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
    return { error: boundaryCaught(initialBoundaryState, error).error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportCrash(this.props.scope, error, info?.componentStack ?? null)
  }

  retry = () => {
    this.setState((state) => boundaryRetried(state))
  }

  render() {
    if (this.state.error) {
      return (
        <Recovery
          scope={this.props.scope}
          title={this.props.title}
          fill={this.props.fill}
          compact={this.props.compact}
          onRetry={this.retry}
        />
      )
    }
    if (this.props.fill) return <View key={this.state.nonce} style={{ flex: 1 }}>{this.props.children}</View>
    return <Fragment key={this.state.nonce}>{this.props.children}</Fragment>
  }
}
