/**
 * Clerk Expo stub — set EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY in .env (never commit secrets).
 * Docs: https://clerk.com/docs/references/expo/overview
 */
import Constants from 'expo-constants';

export const clerkPublishableKey =
  process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ??
  (Constants.expoConfig?.extra as { clerkPublishableKey?: string } | undefined)
    ?.clerkPublishableKey ??
  '';

export function isClerkConfigured(): boolean {
  return Boolean(clerkPublishableKey && !clerkPublishableKey.includes('YOUR_'));
}
