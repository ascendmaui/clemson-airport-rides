import * as SplashScreen from 'expo-splash-screen'
import { quiet } from '@/lib/softFail'

/** Native splash must leave on every path, including a render error. Already-hidden is fine. */
export function hideDriverSplash(): void {
  SplashScreen.hideAsync().catch(quiet('hide splash'))
}
