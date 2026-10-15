import { Pressable, Text } from 'react-native'
import { useTheme } from '@/lib/theme'

/** Text button for a failed ride action. Purple so small type stays readable on white. */
export function RetryAction({
  label = 'Retry',
  hint = 'Tries this again',
  onPress,
}: {
  label?: string
  hint?: string
  onPress: () => void
}) {
  const { colors } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
      hitSlop={8}
      style={{ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' }}
    >
      <Text style={{ color: colors.link, fontWeight: '700', fontSize: 15 }}>{label}</Text>
    </Pressable>
  )
}
