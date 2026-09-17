import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import 'react-native-reanimated';
import { ClerkProvider } from '@clerk/clerk-expo';
import * as SecureStore from 'expo-secure-store';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { clerkPublishableKey, isClerkConfigured } from '@/lib/clerk';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

const tokenCache = {
  async getToken(key: string) {
    try {
      return SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async saveToken(key: string, value: string) {
    try {
      return SecureStore.setItemAsync(key, value);
    } catch {
      return;
    }
  },
};

function RootNav() {
  const colorScheme = useColorScheme();
  const theme =
    colorScheme === 'dark'
      ? {
          ...DarkTheme,
          colors: { ...DarkTheme.colors, primary: Colors.orange, background: '#121212' },
        }
      : {
          ...DefaultTheme,
          colors: { ...DefaultTheme.colors, primary: Colors.orange, background: '#ffffff' },
        };

  return (
    <ThemeProvider value={theme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'About' }} />
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync();
  }, [loaded]);

  if (!loaded) return null;

  if (isClerkConfigured()) {
    return (
      <ClerkProvider publishableKey={clerkPublishableKey} tokenCache={tokenCache}>
        <RootNav />
      </ClerkProvider>
    );
  }

  return <RootNav />;
}
