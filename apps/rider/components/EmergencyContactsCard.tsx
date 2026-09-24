import { useEffect, useState } from 'react'
import { Alert, Linking, Modal, Pressable, Text, TextInput, View } from 'react-native'
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
import { lift } from '@/lib/elevation'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'

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
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)

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
    <View style={[styles.card, lift(colors, 'rest')]}>
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
              placeholderTextColor={colors.placeholder}
              style={styles.input}
            />
            <Text style={styles.label}>Phone</Text>
            <TextInput
              value={draft?.phone || ''}
              onChangeText={(phone) => setDraft((prev) => (prev ? { ...prev, phone } : prev))}
              placeholder="(864) 555-0100"
              placeholderTextColor={colors.placeholder}
              keyboardType="phone-pad"
              style={styles.input}
            />
            <Text style={styles.label}>Relationship</Text>
            <TextInput
              value={draft?.relationship || ''}
              onChangeText={(relationship) => setDraft((prev) => (prev ? { ...prev, relationship } : prev))}
              placeholder="Roommate, parent…"
              placeholderTextColor={colors.placeholder}
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

function makeStyles(colors: Palette) {
  return {
    card: {
      backgroundColor: colors.card,
      borderRadius: 20,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    kicker: { color: colors.orange, fontWeight: '800' as const, letterSpacing: 1.1, fontSize: 11 },
    title: { color: colors.title, fontSize: 20, fontWeight: '800' as const, marginTop: 4, marginBottom: 8 },
    body: { color: colors.inkSecondary, fontSize: 14, lineHeight: 20, marginBottom: 8 },
    empty: { backgroundColor: colors.orangeSoft, borderRadius: 16, padding: 14, marginBottom: 12 },
    emptyTitle: { color: colors.title, fontWeight: '800' as const, fontSize: 16, marginBottom: 4 },
    row: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 8,
      paddingVertical: 10,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    rowCopy: { flex: 1 },
    name: { color: colors.ink, fontWeight: '700' as const, fontSize: 16 },
    meta: { color: colors.inkSecondary, fontSize: 12, marginTop: 2 },
    chip: {
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 6,
      backgroundColor: colors.purpleSoft,
    },
    chipText: { color: colors.link, fontWeight: '700' as const, fontSize: 12 },
    addWrap: { marginTop: 12 },
    error: { color: colors.danger, fontSize: 13, marginTop: 8 },
    backdrop: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' as const },
    sheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      padding: 20,
    },
    label: { color: colors.inkSecondary, fontWeight: '700' as const, fontSize: 13, marginBottom: 6 },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginBottom: 12,
      fontSize: 16,
      color: colors.ink,
      backgroundColor: colors.input,
    },
    remove: { color: colors.danger, fontWeight: '700' as const, textAlign: 'center' as const, marginTop: 14 },
    cancel: { color: colors.link, fontWeight: '700' as const, textAlign: 'center' as const, marginTop: 12 },
  }
}
