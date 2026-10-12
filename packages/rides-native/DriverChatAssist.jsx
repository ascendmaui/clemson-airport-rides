import { useEffect, useRef, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { authedJson } from './apiClient.js'
import { secureStoreAdapter } from './secureStore.js'
import { asAutoReply, isAutoReply } from './chatAssist.js'
import { notifyTripMessage, sendTripMessage } from './tripMessagesClient.js'

const MODE_KEY = 'driver_chat_assist_mode'
const MODES = [
  { id: 'auto', label: 'Auto-reply' },
  { id: 'suggest', label: 'Suggest-only' },
  { id: 'off', label: 'Off' },
]

/**
 * Driver-side assistant for trip chat. Watches for a new rider message, asks
 * /api/trip-messages?action=assist for a reply, then either sends it (Auto-reply,
 * safe intents only) or shows it as a tap-to-use suggestion.
 */
export function useDriverChatAssist({ supabase, tripId, trip, rows, userId, enabled, onSent }) {
  const [mode, setModeState] = useState('suggest')
  const [suggestion, setSuggestion] = useState(null)
  const handled = useRef(null)
  const isDriver = Boolean(enabled && trip && userId && trip.driver_id === userId)

  useEffect(() => {
    if (!isDriver) return
    secureStoreAdapter.getItem(MODE_KEY).then((saved) => {
      if (saved === 'auto' || saved === 'suggest' || saved === 'off') setModeState(saved)
    }).catch(() => {})
  }, [isDriver])

  const setMode = (next) => {
    setModeState(next)
    setSuggestion(null)
    secureStoreAdapter.setItem(MODE_KEY, next).catch(() => {})
  }

  const latest = rows.length ? rows[rows.length - 1] : null
  useEffect(() => {
    if (!isDriver || mode === 'off' || !latest || latest.sender_id !== trip.rider_id) return
    if (handled.current === latest.id) return
    handled.current = latest.id
    setSuggestion(null)
    let alive = true
    authedJson(supabase, '/api/trip-messages?action=assist', { method: 'POST', body: { tripId } })
      .then(async (result) => {
        const reply = result?.suggestion
        if (!alive || !reply?.text || result.messageId !== latest.id) return
        if (mode === 'auto' && reply.autoSendable) {
          const row = await sendTripMessage(supabase, { tripId, body: asAutoReply(reply.text) })
          if (row?.id) await notifyTripMessage(supabase, { tripId, messageId: row.id })
          onSent?.()
        } else {
          setSuggestion({ ...reply, intent: result.intent })
        }
      })
      .catch(() => {})
    return () => { alive = false }
  }, [isDriver, mode, latest?.id, latest?.sender_id, trip?.rider_id, tripId, supabase, onSent])

  return { isDriver, mode, setMode, suggestion, clearSuggestion: () => setSuggestion(null) }
}

export function AutoReplyTag({ body, tone }) {
  if (!isAutoReply(body)) return null
  return <Text style={{ color: tone.inkSecondary, fontSize: 11, fontWeight: '800' }}>Auto-reply</Text>
}

export function DriverAssistBar({ assist, tone, onUse }) {
  if (!assist?.isDriver) return null
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }} accessibilityRole="radiogroup" accessibilityLabel="Chat assistant mode">
        <Text style={{ color: tone.inkSecondary, fontSize: 12, fontWeight: '700' }}>Assistant</Text>
        {MODES.map((item) => {
          const on = assist.mode === item.id
          return (
            <Pressable
              key={item.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={item.label}
              onPress={() => assist.setMode(item.id)}
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: on ? tone.purple : tone.elevated }}
            >
              <Text style={{ color: on ? tone.onAccent : tone.title, fontSize: 12, fontWeight: '800' }}>{item.label}</Text>
            </Pressable>
          )
        })}
      </View>
      {assist.suggestion ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Use suggested reply: ${assist.suggestion.text}`}
          onPress={() => { onUse(assist.suggestion.text); assist.clearSuggestion() }}
          style={{ borderRadius: 12, padding: 10, backgroundColor: tone.purpleSoft, gap: 2 }}
        >
          <Text style={{ color: tone.inkSecondary, fontSize: 11, fontWeight: '800' }}>
            {assist.suggestion.intent === 'fare_refund' ? 'SUGGESTED · fares go through support' : 'SUGGESTED REPLY · tap to edit'}
          </Text>
          <Text style={{ color: tone.ink }}>{assist.suggestion.text}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}
