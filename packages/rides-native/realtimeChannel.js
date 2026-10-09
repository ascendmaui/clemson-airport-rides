let counter = 0

// Supabase reuses channels by topic; each consumer must own its subscription.
export function uniqueChannelTopic(base) {
  counter += 1
  const random = Math.random().toString(36).slice(2, 8).padEnd(6, '0')
  return `${base}:${counter}-${random}`
}
