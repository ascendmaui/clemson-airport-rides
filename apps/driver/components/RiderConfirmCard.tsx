import { Image, StyleSheet, Text, View } from 'react-native'
import { riderConfirmCopy } from 'rides-native/swipeConfirm'
import { useTheme } from '@/lib/theme'
import { SwipeToStart } from '@/components/SwipeToStart'

/** Shown at pickup (status arrived): the rider's first name and photo, then swipe to start. */
export function RiderConfirmCard({
  firstName,
  photoUrl,
  busy,
  onStart,
}: {
  firstName: string
  photoUrl: string | null
  busy: boolean
  onStart: () => void
}) {
  const { colors } = useTheme()
  const copy = riderConfirmCopy({ firstName, photoUrl })
  const initial = (firstName || 'R').trim().slice(0, 1).toUpperCase()
  return (
    <View style={[styles.card, { borderColor: colors.orange, backgroundColor: colors.card }]} accessibilityLabel="Confirm your rider">
      <View style={styles.row}>
        {photoUrl ? (
          <Image source={{ uri: photoUrl }} style={styles.photo} accessibilityLabel={`Photo of ${firstName}`} accessibilityIgnoresInvertColors />
        ) : (
          <View style={[styles.photo, styles.initial, { backgroundColor: colors.fill }]} accessibilityLabel="No rider photo">
            <Text style={[styles.initialText, { color: colors.onAccent }]}>{initial}</Text>
          </View>
        )}
        <View style={styles.text}>
          <Text style={[styles.title, { color: colors.title }]}>{copy.title}</Text>
          <Text style={[styles.body, { color: colors.inkSecondary }]}>{copy.body}</Text>
        </View>
      </View>
      <SwipeToStart label={busy ? 'Starting…' : copy.swipeLabel} a11yLabel={copy.a11yAction} disabled={busy} onConfirm={onStart} />
    </View>
  )
}

const styles = StyleSheet.create({
  card: { borderWidth: 2, borderRadius: 18, padding: 14, gap: 12 },
  row: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  photo: { width: 88, height: 88, borderRadius: 44 },
  initial: { alignItems: 'center', justifyContent: 'center' },
  initialText: { fontSize: 36, fontWeight: '900' },
  text: { flex: 1, gap: 4 },
  title: { fontSize: 24, fontWeight: '900' },
  body: { fontSize: 14, lineHeight: 20 },
})
