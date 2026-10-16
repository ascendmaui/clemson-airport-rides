import * as SplashScreen from 'expo-splash-screen'

/** Native splash must leave on every path, including a render error. Already-hidden is fine. */
export function hideDriverSplash(): void {
  SplashScreen.hideAsync().catch(() => {})
}
