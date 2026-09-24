/** Public Clerk values. Secrets stay on Vercel and are never EXPO_PUBLIC_. */

export function clerkPublishableKey() {
  return String(process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY || '').trim()
}

export function missingClerkPublishableMessage() {
  return 'Apple, Google, and Facebook sign-in need EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY on the driver EAS project. Email and password still work.'
}
