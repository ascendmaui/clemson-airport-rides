import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useTheme } from '@/lib/theme'

type BoundaryProps = {
  children: ReactNode
  title: string
  fill?: boolean
}

type BoundaryState = {
  error: Error | null
  nonce: number
}

function FlowFallback({ title, onRetry, fill }: { title: string; onRetry: () => void; fill?: boolean }) {
  const { colors } = useTheme()
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      style={{
        flex: fill ? 1 : undefined,
        justifyContent: 'center',
        padding: 24,
        gap: 12,
        backgroundColor: colors.background,
      }}
    >
      <Text style={{ color: colors.orange, fontWeight: '800', letterSpacing: 1, fontSize: 12 }}>SOMETHING WENT WRONG</Text>
      <Text style={{ color: colors.title, fontSize: 22, fontWeight: '700' }}>{title}</Text>
      <Text style={{ color: colors.inkSecondary, fontSize: 15, lineHeight: 21 }}>
        This part of the ride could not be shown. Try again.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Try again"
        onPress={onRetry}
        style={{
          alignSelf: 'flex-start',
          backgroundColor: colors.orange,
          borderRadius: 14,
          paddingVertical: 12,
          paddingHorizontal: 18,
        }}
      >
        <Text style={{ color: colors.onAccent, fontWeight: '700' }}>Try again</Text>
      </Pressable>
    </View>
  )
}

/**
 * Keeps a render error in the matching or live-trip flow on that flow.
 * Retry remounts the children.
 */
export class FlowErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null, nonce: 0 }

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('[rider-flow]', error, info.componentStack)
  }

  retry = () => {
    this.setState((state) => ({ error: null, nonce: state.nonce + 1 }))
  }

  render() {
    if (this.state.error) {
      return <FlowFallback title={this.props.title} onRetry={this.retry} fill={this.props.fill} />
    }
    if (this.props.fill) {
      return <View key={this.state.nonce} style={{ flex: 1 }}>{this.props.children}</View>
    }
    return <Fragment key={this.state.nonce}>{this.props.children}</Fragment>
  }
}
