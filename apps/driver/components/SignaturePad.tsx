import { useRef, useState } from 'react'
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native'

type Point = { x: number; y: number }

export function SignaturePad({
  onChange,
  ink = '#111111',
}: {
  onChange: (points: Point[]) => void
  ink?: string
}) {
  const [points, setPoints] = useState<Point[]>([])
  const draft = useRef<Point[]>([])
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => {
      const { locationX, locationY } = event.nativeEvent
      draft.current = [...draft.current, { x: locationX, y: locationY }]
      setPoints(draft.current)
      onChange(draft.current)
    },
    onPanResponderMove: (event) => {
      const { locationX, locationY } = event.nativeEvent
      draft.current = [...draft.current, { x: locationX, y: locationY }]
      setPoints(draft.current.slice())
      onChange(draft.current)
    },
  })).current

  return (
    <View style={styles.wrap}>
      <View {...responder.panHandlers} style={styles.pad}>
        {points.length === 0 ? <Text style={styles.hint}>Sign here</Text> : null}
        {points.map((point, index) => (
          <View key={`${index}-${point.x}`} style={[styles.dot, { left: point.x, top: point.y, backgroundColor: ink }]} />
        ))}
      </View>
      <Pressable
        onPress={() => {
          draft.current = []
          setPoints([])
          onChange([])
        }}
        accessibilityRole="button"
      >
        <Text style={styles.clear}>Clear signature</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  pad: {
    height: 140,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D7D3DE',
    overflow: 'hidden',
  },
  hint: { color: '#8B939E', padding: 12 },
  dot: { position: 'absolute', width: 3, height: 3, borderRadius: 2 },
  clear: { fontWeight: '700', fontSize: 13 },
})
