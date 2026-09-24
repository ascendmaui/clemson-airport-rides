import { useEffect, useState } from 'react'
import { Alert, Linking, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PrimaryButton } from '@/components/Button'
import { supabase } from '@/lib/supabase'
import {
  MAX_EMERGENCY_CONTACTS,
  contactTel,
  deleteEmergencyContact,
  listEmergencyContacts,
  saveEmergencyContact,
  type EmergencyContact,
} from 'rides-native/safety.js'
import { INK, INK_SECONDARY, ORANGE, PURPLE } from 'rides-native/places.js'

type Draft = {
  id?: string
  name: string
  phone: string
  relationship: string
}

const EMPTY_DRAFT: Draft = { name: '', phone: '', relationship: '' }

export function EmergencyContactsCard({
  userId,
  onContacts,
}: {
  userId: string | null
  onContacts?: (contacts: EmergencyContact[]) => void
}) {
  const insets = useSafeAreaInsets()
  const [contacts, setContacts] = useState<EmergencyContact[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)

  function publish(next: EmergencyContact[]) {
    setContacts(next)
    onContacts?.(next)
  }

  useEffect(() => {
    if (!userId || !supabase) {
      publish([])
      return undefined
    }
    let alive = true
    setLoading(true)
    listEmergencyContacts(supabase, userId).then((result) => {
      if (!alive) return
      setError(result.error)
      publish(result.contacts)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [userId])

  async function onSave() {
    if (!draft || !userId || !supabase) return
    setSaving(true)
    setError(null)
    const result = await saveEmergencyContact(supabase, userId, draft)
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    const next = draft.id
      ? contacts.map((row) => (row.id === result.contact.id ? result.contact : row))
      : [...contacts, result.contact]
    publish(next)
    setDraft(null)
  }

  function onRemove(contact: EmergencyContact) {
    Alert.alert('Remove contact', `Remove ${contact.name} from emergency contacts?`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          if (!userId || !supabase) return
          const result = await deleteEmergencyContact(supabase, userId, contact.id)
          if (!result.ok) {
            setError(result.error || 'Could not remove contact')
            return
          }
          publish(contacts.filter((row) => row.id !== contact.id))
          setDraft(null)
        },
      },
    ])
  }

  async function onCall(phone: string) {
    const href = contactTel(phone)
    if (!href) return
    try {
      await Linking.openURL(href)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the call')
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.kicker}>PEOPLE YOU TRUST</Text>
      <Text style={styles.title}>Emergency contacts</Text>
      <Text style={styles.body}>Add, edit, or call someone from this phone. The list stays on your Clemson RIDES account.</Text>
      {loading ? <Text style={styles.body}>Loading contacts…</Text> : null}
      {!loading && contacts.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No emergency contacts yet</Text>
          <Text style={styles.body}>Add a roommate, parent, or friend. You can call them from SOS during a ride.</Text>
        </View>
      ) : null}
      {contacts.map((contact) => (
        <View key={contact.id} style={styles.row}>
          <View style={styles.rowCopy}>
            <Text style={styles.name}>{contact.name}</Text>
            <Text style={styles.meta}>
              {contact.relationship ? `${contact.relationship} · ` : ''}{contact.phone}
            </Text>
          </View>
          <Pressable accessibilityRole="button" onPress={() => onCall(contact.phone)} style={styles.chip}>
            <Text style={styles.chipText}>Call</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setDraft({
              id: contact.id,
              name: contact.name,
              phone: contact.phone,
              relationship: contact.relationship || '',
            })}
            style={styles.chip}
          >
            <Text style={styles.chipText}>Edit</Text>
          </Pressable>
        </View>
      ))}
      {contacts.length < MAX_EMERGENCY_CONTACTS ? (
        <View style={styles.addWrap}>
          <PrimaryButton label="Add contact" onPress={() => { setError(null); setDraft(EMPTY_DRAFT) }} tone="purple" />
        </View>
      ) : (
        <Text style={styles.meta}>Five contacts is the limit. Edit one to change it.</Text>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Modal visible={Boolean(draft)} animationType="slide" transparent onRequestClose={() => setDraft(null)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 20) }]}>
            <Text style={styles.title}>{draft?.id ? 'Edit contact' : 'Add contact'}</Text>
            <Text style={styles.label}>Name</Text>
            <TextInput
              value={draft?.name || ''}
              onChangeText={(name) => setDraft((prev) => (prev ? { ...prev, name } : prev))}
              placeholder="Name"
              placeholderTextColor="#8B939E"
              style={styles.input}
            />
            <Text style={styles.label}>Phone</Text>
            <TextInput
              value={draft?.phone || ''}
              onChangeText={(phone) => setDraft((prev) => (prev ? { ...prev, phone } : prev))}
              placeholder="(864) 555-0100"
              placeholderTextColor="#8B939E"
              keyboardType="phone-pad"
              style={styles.input}
            />
            <Text style={styles.label}>Relationship</Text>
            <TextInput
              value={draft?.relationship || ''}
              onChangeText={(relationship) => setDraft((prev) => (prev ? { ...prev, relationship } : prev))}
              placeholder="Roommate, parent…"
              placeholderTextColor="#8B939E"
              style={styles.input}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <PrimaryButton label={saving ? 'Saving…' : 'Save contact'} onPress={onSave} disabled={saving} />
            {draft?.id ? (
              <Pressable onPress={() => draft.id && onRemove({ id: draft.id, user_id: userId || '', name: draft.name, phone: draft.phone, relationship: draft.relationship || null })}>
                <Text style={styles.remove}>Remove contact</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={() => setDraft(null)}>
              <Text style={styles.cancel}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(82,45,128,0.12)',
  },
  kicker: { color: ORANGE, fontWeight: '800', letterSpacing: 1.1, fontSize: 11 },
  title: { color: PURPLE, fontSize: 20, fontWeight: '800', marginTop: 4, marginBottom: 8 },
  body: { color: INK_SECONDARY, fontSize: 14, lineHeight: 20, marginBottom: 8 },
  empty: { backgroundColor: 'rgba(245,102,0,0.08)', borderRadius: 16, padding: 14, marginBottom: 12 },
  emptyTitle: { color: PURPLE, fontWeight: '800', fontSize: 16, marginBottom: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(82,45,128,0.12)',
  },
  rowCopy: { flex: 1 },
  name: { color: INK, fontWeight: '700', fontSize: 16 },
  meta: { color: INK_SECONDARY, fontSize: 12, marginTop: 2 },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(82,45,128,0.08)',
  },
  chipText: { color: PURPLE, fontWeight: '700', fontSize: 12 },
  addWrap: { marginTop: 12 },
  error: { color: '#B42318', fontSize: 13, marginTop: 8 },
  backdrop: { flex: 1, backgroundColor: 'rgba(11,18,32,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
  },
  label: { color: INK_SECONDARY, fontWeight: '700', fontSize: 13, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(82,45,128,0.16)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    fontSize: 16,
    color: INK,
  },
  remove: { color: '#B42318', fontWeight: '700', textAlign: 'center', marginTop: 14 },
  cancel: { color: PURPLE, fontWeight: '700', textAlign: 'center', marginTop: 12 },
})
