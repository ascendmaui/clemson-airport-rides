import { useEffect, useState } from 'react'
import { Pressable, Switch, Text, TextInput, View } from 'react-native'
import {
  COMMUNITY_FIELDS, COMMUNITY_PRIVACY_NOTE, EMPTY_COMMUNITY,
  loadCommunityProfile, removeCommunityProfile, saveCommunityProfile,
} from './community.js'

/** Account › Campus community: opt-in fields, each with its own share switch (off by default). */
export function CommunityProfileEditor({ supabase, userId, colors = {} }) {
  const [form, setForm] = useState({ ...EMPTY_COMMUNITY })
  const [note, setNote] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let alive = true
    loadCommunityProfile(supabase, userId)
      .then((row) => { if (alive) setForm({ ...row, courses: (row.courses || []).join(', '), grad_year: row.grad_year ? String(row.grad_year) : '' }) })
      .catch((err) => { if (alive) setNote(err.message) })
    return () => { alive = false }
  }, [supabase, userId])
  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }))
  const save = async () => {
    setBusy(true); setNote(null)
    try {
      const row = await saveCommunityProfile(supabase, userId, form)
      setForm((prev) => ({ ...prev, ...Object.fromEntries(COMMUNITY_FIELDS.map((f) => [f.share, row[f.share]])), courses: row.courses.join(', ') }))
      setNote('Saved.')
    } catch (err) { setNote(err.message) } finally { setBusy(false) }
  }
  const remove = async () => {
    setBusy(true); setNote(null)
    try {
      await removeCommunityProfile(supabase, userId)
      setForm({ ...EMPTY_COMMUNITY, courses: '', grad_year: '' })
      setNote('Removed. Nothing is stored now.')
    } catch (err) { setNote(err.message) } finally { setBusy(false) }
  }
  const input = { borderWidth: 1, borderColor: colors.border || '#ddd', borderRadius: 12, padding: 10, color: colors.title || '#222', backgroundColor: colors.card || '#fff' }
  return (
    <View style={{ gap: 14 }}>
      <Text style={{ color: colors.inkSecondary || '#555', lineHeight: 20 }}>{COMMUNITY_PRIVACY_NOTE}</Text>
      {COMMUNITY_FIELDS.map((f) => (
        <View key={f.key} style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: colors.title || '#222', fontWeight: '800' }}>{f.label}</Text>
            <Switch
              value={Boolean(form[f.share])}
              onValueChange={(v) => set(f.share, v)}
              accessibilityLabel={`Show ${f.label} matches`}
            />
          </View>
          <TextInput
            value={String(form[f.key] ?? '')}
            onChangeText={(v) => set(f.key, v)}
            placeholder={f.placeholder}
            placeholderTextColor={colors.inkSecondary || '#888'}
            keyboardType={f.key === 'grad_year' ? 'number-pad' : 'default'}
            autoCapitalize={f.key === 'courses' ? 'characters' : 'words'}
            maxLength={f.key === 'courses' ? 120 : 60}
            style={input}
            accessibilityLabel={f.label}
          />
          <Text style={{ color: colors.inkSecondary || '#777', fontSize: 12 }}>Others would see only: “{f.example}”</Text>
        </View>
      ))}
      <Pressable onPress={save} disabled={busy} accessibilityRole="button" style={{ backgroundColor: colors.orange || '#F56600', borderRadius: 14, padding: 14, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
        <Text style={{ color: '#fff', fontWeight: '800' }}>{busy ? 'Saving…' : 'Save'}</Text>
      </Pressable>
      <Pressable onPress={remove} disabled={busy} accessibilityRole="button" style={{ padding: 12, alignItems: 'center' }}>
        <Text style={{ color: colors.danger || '#B00020', fontWeight: '700' }}>Remove all community info</Text>
      </Pressable>
      {note ? <Text accessibilityLiveRegion="polite" style={{ color: colors.inkSecondary || '#555' }}>{note}</Text> : null}
    </View>
  )
}
