import { useCallback, useEffect, useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { INBOX_KIND_LABELS } from '../../shared/adminInbox.js'
import { WEB_ADMIN_URL, loadAdminInbox, runAdminInboxAction } from './adminInboxClient.js'

export function AdminInboxScreen({ supabase, colors, onBack, onOpenWeb }) {
  const [access, setAccess] = useState(null)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [reasons, setReasons] = useState({})
  const [busyId, setBusyId] = useState('')
  const ink = colors?.title || '#522D80'
  const muted = colors?.inkSecondary || '#666'

  const reload = useCallback(() => {
    setError('')
    return loadAdminInbox(supabase)
      .then((data) => setAccess(data))
      .catch((err) => setError(err?.message || 'Could not load the admin list'))
  }, [supabase])

  useEffect(() => {
    reload()
  }, [reload])

  async function run(item, action) {
    setError('')
    setNote('')
    if (action.method === 'GET' || action.webUrl) {
      const url = action.webUrl || WEB_ADMIN_URL
      if (onOpenWeb) onOpenWeb(url)
      return
    }
    const requestKey = `${item.id}:${action.id}`
    setBusyId(requestKey)
    try {
      const data = await runAdminInboxAction(supabase, action, { reason: reasons[item.id] })
      setNote(data?.message || `${action.label} saved`)
      await reload()
    } catch (err) {
      setError(err?.message || 'Could not complete that action')
    } finally {
      setBusyId('')
    }
  }

  const items = access?.items || []
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors?.background || '#f6f3f8' }} contentContainerStyle={{ padding: 20, gap: 12 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack}>
        <Text style={{ color: ink, fontSize: 20 }}>←</Text>
      </Pressable>
      <Text style={{ color: '#F56600', fontWeight: '800', letterSpacing: 1 }}>CLEMSON RIDES</Text>
      <Text style={{ color: ink, fontSize: 28, fontWeight: '800' }}>Admin</Text>
      <Text style={{ color: muted, lineHeight: 20 }}>
        {access?.admin === false
          ? 'Admin access required.'
          : 'Document reviews, applicants, inspections, lost items, payouts, failed holds, and stuck trips.'}
      </Text>
      {access?.admin ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open web admin"
          onPress={() => onOpenWeb?.(WEB_ADMIN_URL)}
          style={{ alignSelf: 'flex-start', paddingVertical: 8 }}
        >
          <Text style={{ color: '#F56600', fontWeight: '800' }}>Open web admin</Text>
        </Pressable>
      ) : null}
      {error ? <Text style={{ color: colors?.danger || '#9b2335' }}>{error}</Text> : null}
      {note ? <Text style={{ color: '#1d6b34' }}>{note}</Text> : null}
      {access?.admin && items.length === 0 ? <Text style={{ color: muted }}>Nothing is waiting.</Text> : null}
      {items.map((item) => {
        const needsReason = item.actions?.some((action) => action.needsReason)
        return (
          <View key={item.id} style={{ backgroundColor: colors?.card || '#fff', borderRadius: 16, padding: 14, gap: 6 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: '#F56600', fontWeight: '800', fontSize: 12 }}>{INBOX_KIND_LABELS[item.kind] || item.kind}</Text>
              <Text style={{ color: muted, fontWeight: '700', fontSize: 12 }}>{item.ageLabel}</Text>
            </View>
            <Text style={{ color: ink, fontWeight: '800', fontSize: 16 }}>{item.title}</Text>
            <Text style={{ color: muted, lineHeight: 18 }}>{item.detail}</Text>
            {item.body ? <Text style={{ color: ink, lineHeight: 18 }}>{item.body}</Text> : null}
            {needsReason ? (
              <TextInput
                value={reasons[item.id] || ''}
                onChangeText={(text) => setReasons((prev) => ({ ...prev, [item.id]: text }))}
                placeholder="Reason"
                placeholderTextColor={muted}
                style={{
                  borderWidth: 1,
                  borderColor: 'rgba(82,45,128,0.2)',
                  borderRadius: 10,
                  padding: 10,
                  color: ink,
                }}
              />
            ) : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
              {(item.actions || []).map((action) => {
                const requestKey = `${item.id}:${action.id}`
                const opensWeb = action.method === 'GET' || Boolean(action.webUrl && action.method !== 'POST')
                return (
                  <Pressable
                    key={action.id}
                    accessibilityRole="button"
                    accessibilityLabel={action.label}
                    disabled={busyId === requestKey}
                    onPress={() => run(item, action)}
                    style={{
                      backgroundColor: opensWeb ? '#fff' : '#F56600',
                      borderRadius: 999,
                      paddingVertical: 8,
                      paddingHorizontal: 12,
                      borderWidth: 1,
                      borderColor: 'rgba(82,45,128,0.15)',
                    }}
                  >
                    <Text style={{ color: opensWeb ? '#522D80' : '#fff', fontWeight: '700' }}>
                      {busyId === requestKey ? 'Working…' : action.label}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
          </View>
        )
      })}
    </ScrollView>
  )
}
