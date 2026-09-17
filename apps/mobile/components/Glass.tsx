import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
  StyleProp,
  Platform,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Glass as G, orange, purple } from '@/constants/Colors';

export function AppBackdrop({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.flex}>
      <LinearGradient
        colors={['#F7EFE6', '#EDE8F6', '#E6EBF4']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.orb, styles.orbOrange]} />
      <View style={[styles.orb, styles.orbPurple]} />
      {children}
    </View>
  );
}

export function GlassCard({
  children,
  style,
  intensity = 42,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  intensity?: number;
}) {
  return (
    <View style={[styles.cardOuter, G.shadow, style]}>
      <BlurView intensity={intensity} tint="light" style={styles.cardInner}>
        <View style={styles.hairline}>{children}</View>
      </BlurView>
    </View>
  );
}

export function GlassSheet({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.sheetOuter, G.shadow, style]}>
      <BlurView intensity={58} tint="light" style={styles.sheetInner}>
        <View style={styles.sheetHairline}>{children}</View>
      </BlurView>
    </View>
  );
}

export function SpringButton({
  label,
  onPress,
  variant = 'primary',
  disabled,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost' | 'purple';
  disabled?: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const pressIn = () =>
    Animated.spring(scale, { toValue: 0.94, useNativeDriver: true, friction: 5, tension: 220 }).start();
  const pressOut = () =>
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 5, tension: 160 }).start();

  const bg = variant === 'primary' ? orange : variant === 'purple' ? purple : 'rgba(255,255,255,0.48)';
  const color = variant === 'ghost' ? purple : '#fff';

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      onPressIn={pressIn}
      onPressOut={pressOut}
      style={{ opacity: disabled ? 0.5 : 1 }}
    >
      <Animated.View style={[styles.btn, { backgroundColor: bg, transform: [{ scale }] }, G.softShadow]}>
        <Text style={[styles.btnText, { color }]}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}

export function MapPin({ label, accent = 'orange' }: { label: string; accent?: 'orange' | 'purple' }) {
  const scale = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 4, tension: 130 }).start();
  }, [scale]);
  const c = accent === 'orange' ? orange : purple;
  return (
    <Animated.View style={[styles.pinWrap, { transform: [{ scale }] }]}>
      <View style={[styles.pin, { backgroundColor: c }, G.softShadow]}>
        <Text style={styles.pinText}>{label}</Text>
      </View>
      <View style={[styles.pinStem, { backgroundColor: c }]} />
    </Animated.View>
  );
}

export function FadeIn({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const y = useRef(new Animated.Value(14)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 420, delay, useNativeDriver: true }),
      Animated.spring(y, { toValue: 0, friction: 8, tension: 80, delay, useNativeDriver: true }),
    ]).start();
  }, [opacity, y, delay]);
  return <Animated.View style={{ opacity, transform: [{ translateY: y }] }}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  orb: { position: 'absolute', width: 240, height: 240, borderRadius: 120, opacity: 0.5 },
  orbOrange: { top: -50, left: -70, backgroundColor: 'rgba(245, 102, 0, 0.28)' },
  orbPurple: { top: 140, right: -90, backgroundColor: 'rgba(82, 45, 128, 0.22)' },
  cardOuter: { borderRadius: 22, overflow: Platform.OS === 'ios' ? 'visible' : 'hidden' },
  cardInner: { borderRadius: 22, overflow: 'hidden', backgroundColor: G.fill },
  hairline: {
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: G.hairline,
    padding: 16,
  },
  sheetOuter: { borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden' },
  sheetInner: { backgroundColor: G.fillStrong },
  sheetHairline: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: G.hairline,
    padding: 20,
    paddingBottom: 28,
  },
  btn: { paddingVertical: 14, paddingHorizontal: 20, borderRadius: 16, alignItems: 'center' },
  btnText: { fontWeight: '700', fontSize: 16, letterSpacing: 0.2 },
  pinWrap: { alignItems: 'center' },
  pin: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  pinText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  pinStem: { width: 3, height: 10, marginTop: -1, borderRadius: 2 },
});
