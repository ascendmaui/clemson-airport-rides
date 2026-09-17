const raw =
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ||
  import.meta.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
  ''

export const clerkPublishableKey = String(raw).trim()

/** Real Clerk pk only — placeholders leave auth optional so UI still renders. */
export const isClerkConfigured = Boolean(
  clerkPublishableKey &&
    clerkPublishableKey.startsWith('pk_') &&
    !clerkPublishableKey.includes('placeholder'),
)
