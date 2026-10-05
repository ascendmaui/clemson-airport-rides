import { useEffect, useRef } from 'react'
import { Animated, Pressable, Text, View } from 'react-native'
import {
  GENDER_OPTIONS,
  comfortPreferenceCopy,
  womenOnlyPreferenceAllowed,
} from '../../shared/womenOnlyMatch.js'

export function WomenOnlyCard({
  role = 'rider',
  genderIdentity = 'unspecified',
  womenOnlyMatching = false,
  busy = false,
  available = true,
  note = null,
  colors,
  onGender,
  onToggle,
}) {
  const copy = comfortPreferenceCopy(role)
  const allowed = womenOnlyPreferenceAllowed(genderIdentity)
  const on = Boolean(womenOnlyMatching) && allowed
  const knob = useRef(new Animated.Value(on ? 1 : 0)).current

  useEffect(() => {
    Animated.spring(knob, {
      toValue: on ? 1 : 0,
      useNativeDriver: false,
      friction: 7,
      tension: 90,
    }).start()
  }, [knob, on])

  const translateX = knob.interpolate({ inputRange: [0, 1], outputRange: [3, 26] })
  const trackColor = knob.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.purpleSoft || 'rgba(82,45,128,0.16)', colors.orange || '#F56600'],
  })

  return (
    <View style={{
      backgroundColor: colors.card,
      borderRadius: 20,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 12,
    }}>
      <Text style={{ color: colors.orange, fontWeight: '800', letterSpacing: 1.1, fontSize: 11 }}>{copy.kicker}</Text>
      <Text style={{ color: colors.title, fontWeight: '800', fontSize: 18 }}>{copy.title}</Text>
      <Text style={{ color: colors.inkSecondary, fontSize: 14, lineHeight: 20 }}>{copy.body}</Text>
      <Text style={{ color: colors.inkSecondary, fontSize: 13, lineHeight: 18 }}>How you identify</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {GENDER_OPTIONS.map((option) => {
          const selected = genderIdentity === option.id
          return (
            <Pressable
              key={option.id}
              accessibilityRole="button"
              accessibilityLabel={option.label}
              accessibilityState={{ selected, disabled: busy || !available }}
              disabled={busy || !available}
              onPress={() => onGender?.(option.id)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 999,
                backgroundColor: selected ? colors.purple : colors.purpleSoft,
                borderWidth: 1,
                borderColor: selected ? colors.purple : colors.border,
              }}
            >
              <Text style={{ color: selected ? colors.onAccent : colors.purple, fontWeight: '700', fontSize: 13 }}>
                {option.label}
              </Text>
            </Pressable>
          )
        })}
      </View>
      <Pressable
        accessibilityRole="switch"
        accessibilityLabel={copy.title}
        accessibilityHint={allowed ? 'Turns the comfort preference on or off' : copy.locked}
        accessibilityState={{ checked: on, disabled: busy || !available || !allowed }}
        disabled={busy || !available || !allowed}
        onPress={() => onToggle?.(!on)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
      >
        <Animated.View style={{
          width: 52,
          height: 30,
          borderRadius: 999,
          backgroundColor: trackColor,
          justifyContent: 'center',
          opacity: allowed && available ? 1 : 0.45,
        }}>
          <Animated.View style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            backgroundColor: '#fff',
            transform: [{ translateX }],
            shadowColor: '#1A1033',
            shadowOpacity: 0.18,
            shadowRadius: 3,
            shadowOffset: { width: 0, height: 1 },
          }} />
        </Animated.View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.title, fontWeight: '800' }}>{on ? 'On for your rides' : 'Off'}</Text>
          <Text style={{ color: colors.inkSecondary, fontSize: 12, lineHeight: 16 }}>
            {available ? (allowed ? 'Saved to your profile' : copy.locked) : 'This comfort preference needs a database update before it can be saved.'}
          </Text>
        </View>
      </Pressable>
      {note ? <Text style={{ color: colors.orange, fontWeight: '700', fontSize: 13 }}>{note}</Text> : null}
    </View>
  )
}
