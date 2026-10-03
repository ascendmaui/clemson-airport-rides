import { useEffect, useRef, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAuth } from '@/lib/auth'
import { notifyDriverAssigned } from '@/lib/push'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'

type AssignmentNotice = {
  id: string
  title: string
  body: string
  trip_id?: string | null
}

/** Foreground banner plus the local notification for an assigned ride. iOS and Android. */
export function AssignmentAlerts() {
  const { user } = useAuth()
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const [notice, setNotice] = useState<AssignmentNotice | null>(null)
  const seen = useRef(new Set<string>())

  useEffect(() => {
    if (!supabase || !user?.id) return undefined
    let alive = true
    const show = (row: AssignmentNotice | null, announce: boolean) => {
      if (!alive || !row?.id) return
      setNotice(row)
      if (!announce || seen.current.has(row.id)) return
      seen.current.add(row.id)
      notifyDriverAssigned({
        id: row.trip_id || row.id,
        title: row.title,
        body: row.body,
      }).catch(() => {})
    }
    const load = async (announce: boolean) => {
      const { data } = await supabase
        .from('driver_notifications')
        .select('id, title, body, trip_id')
        .eq('driver_id', user.id)
        .eq('kind', 'ride_assigned')
        .is('read_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
      show((data?.[0] as AssignmentNotice) || null, announce)
    }
    load(true).catch(() => {})
    const channel = supabase
      .channel(`driver-assignment-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'driver_notifications',
        filter: `driver_id=eq.${user.id}`,
      }, (payload: { new?: AssignmentNotice & { kind?: string } }) => {
        if (payload.new?.kind === 'ride_assigned') show(payload.new, true)
      })
      .subscribe()
    const poll = setInterval(() => { load(true).catch(() => {}) }, 12000)
    return () => {
      alive = false
      clearInterval(poll)
      supabase.removeChannel(channel)
    }
  }, [user?.id])

  if (!notice) return null

  return (
    <View
      accessibilityRole="alert"
      style={{
        position: 'absolute',
        top: insets.top + 8,
        left: 16,
        right: 16,
        zIndex: 40,
        backgroundColor: colors.card,
        borderRadius: 16,
        borderWidth: 1.5,
        borderColor: colors.orange,
        padding: 14,
        gap: 6,
      }}
    >
      <Text style={{ color: colors.orange, fontWeight: '800', fontSize: 16 }}>{notice.title}</Text>
      <Text style={{ color: colors.purple, fontSize: 13, lineHeight: 18 }}>{notice.body}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss assignment alert"
        onPress={() => {
          const id = notice.id
          setNotice(null)
          if (!supabase) return
          supabase.from('driver_notifications').update({ read_at: new Date().toISOString() }).eq('id', id).then(() => {})
        }}
      >
        <Text style={{ color: colors.purple, fontWeight: '800' }}>Dismiss</Text>
      </Pressable>
    </View>
  )
}
