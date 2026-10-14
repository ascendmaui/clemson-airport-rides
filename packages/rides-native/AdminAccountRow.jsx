import { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { loadAdminInbox } from './adminInboxClient.js'

export function AdminAccountRow({ supabase, colors, onPress }) {
  const [access, setAccess] = useState(null)

  useEffect(() => {
    let alive = true
    if (!supabase) {
      setAccess({ admin: false })
      return undefined
    }
    loadAdminInbox(supabase)
      .then((data) => {
        if (alive) setAccess(data)
      })
      .catch(() => {
        if (alive) setAccess({ admin: false })
      })
    return () => {
      alive = false
    }
  }, [supabase])

  if (!access?.admin || access?.isAdmin !== true) return null
  const count = Number(access.total) || 0
  const ink = colors?.title || colors?.ink || '#522D80'
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={count ? `Admin, ${count} to do` : 'Admin'}
      onPress={onPress}
      style={{
        backgroundColor: colors?.card || '#fff',
        borderRadius: 16,
        paddingVertical: 14,
        paddingHorizontal: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: ink, fontWeight: '800', fontSize: 16 }}>Admin</Text>
        <Text style={{ color: colors?.inkSecondary || '#666', marginTop: 2 }}>
          {count ? `${count} waiting on you` : 'Nothing waiting'}
        </Text>
      </View>
      {count > 0 ? (
        <View style={{
          minWidth: 28,
          height: 28,
          borderRadius: 14,
          backgroundColor: '#F56600',
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 8,
        }}
        >
          <Text style={{ color: '#fff', fontWeight: '800' }}>{count > 99 ? '99+' : String(count)}</Text>
        </View>
      ) : null}
    </Pressable>
  )
}
