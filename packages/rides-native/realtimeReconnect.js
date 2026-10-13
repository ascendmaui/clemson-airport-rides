import { uniqueChannelTopic } from './realtimeChannel.js'

/**
 * Postgres-changes subscription that refetches when the channel drops and
 * again when it reconnects. Callers own what the refetch does.
 */

export const REALTIME_RECONNECT_MS = 2000
export const REALTIME_DROP_STATUSES = Object.freeze(['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'])

export function bindRealtimeChannel(supabase, { topic, onChange, resubscribeMs = REALTIME_RECONNECT_MS } = {}) {
  if (!supabase || typeof supabase.channel !== 'function') return () => {}
  let stopped = false
  let channel = null
  let timer = null
  let sawDrop = false

  function attach() {
    if (stopped) return
    const base = typeof topic === 'function' ? topic() : (topic || 'trips')
    channel = supabase
      .channel(uniqueChannelTopic(base))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, (payload) => {
        onChange?.(payload)
      })
      .subscribe((status) => {
        if (stopped) return
        if (status === 'SUBSCRIBED') {
          if (sawDrop) onChange?.({ eventType: 'RECONNECT' })
          sawDrop = false
          return
        }
        if (!REALTIME_DROP_STATUSES.includes(status)) return
        sawDrop = true
        onChange?.({ eventType: 'RECONNECT', status })
        const dying = channel
        channel = null
        if (dying) {
          try { supabase.removeChannel(dying) } catch { /* already removed */ }
        }
        clearTimeout(timer)
        timer = setTimeout(attach, resubscribeMs)
      })
  }

  attach()
  return () => {
    stopped = true
    clearTimeout(timer)
    if (channel) {
      const dying = channel
      channel = null
      try { supabase.removeChannel(dying) } catch { /* already removed */ }
    }
  }
}
