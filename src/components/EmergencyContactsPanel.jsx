import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import {
  MAX_EMERGENCY_CONTACTS,
  deleteEmergencyContact,
  listEmergencyContacts,
  saveEmergencyContact,
} from '../../packages/rides-native/safety.js'

const inputStyle = {
  width: '100%',
  marginTop: 6,
  marginBottom: 10,
  padding: '10px 12px',
  borderRadius: 12,
  border: '1px solid rgba(82,45,128,0.16)',
  fontSize: 15,
}

export function EmergencyContactsPanel() {
  const { user } = useAuth()
  const [contacts, setContacts] = useState([])
  const [error, setError] = useState(null)
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!user?.id || !supabase) {
      setContacts([])
      return undefined
    }
    let alive = true
    listEmergencyContacts(supabase, user.id).then((result) => {
      if (!alive) return
      setError(result.error)
      setContacts(result.contacts)
    })
    return () => {
      alive = false
    }
  }, [user?.id])

  async function onSave(event) {
    event.preventDefault()
    if (!draft || !user?.id || !supabase) return
    setSaving(true)
    setError(null)
    const result = await saveEmergencyContact(supabase, user.id, draft)
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setContacts((prev) => (
      draft.id
        ? prev.map((row) => (row.id === result.contact.id ? result.contact : row))
        : [...prev, result.contact]
    ))
    setDraft(null)
  }

  async function onRemove(contact) {
    if (!user?.id || !supabase) return
    const result = await deleteEmergencyContact(supabase, user.id, contact.id)
    if (!result.ok) {
      setError(result.error || 'Could not remove contact')
      return
    }
    setContacts((prev) => prev.filter((row) => row.id !== contact.id))
  }

  if (!user) return null

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontWeight: 800, color: 'var(--purple)', marginBottom: 4 }}>Emergency contacts</div>
      <p style={{ fontSize: 13, color: 'var(--ink-secondary)', lineHeight: 1.45, marginTop: 0 }}>
        The same list the rider app uses. Add, edit, or remove someone you can call during a ride.
      </p>
      {contacts.length === 0 && !draft ? (
        <div style={{ padding: 12, borderRadius: 14, background: 'rgba(245,102,0,0.08)', marginBottom: 10 }}>
          <div style={{ fontWeight: 700, color: 'var(--purple)' }}>No emergency contacts yet</div>
          <div style={{ fontSize: 13, color: 'var(--ink-tertiary)', marginTop: 4 }}>
            Add a roommate, parent, or friend. Up to {MAX_EMERGENCY_CONTACTS}.
          </div>
        </div>
      ) : null}
      {contacts.map((contact) => (
        <div key={contact.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 0', borderTop: '1px solid rgba(82,45,128,0.1)' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700 }}>{contact.name}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-tertiary)' }}>
              {contact.relationship ? `${contact.relationship} · ` : ''}{contact.phone}
            </div>
          </div>
          <button type="button" className="pressable" onClick={() => setDraft({ id: contact.id, name: contact.name, phone: contact.phone, relationship: contact.relationship || '' })} style={{ fontWeight: 700, color: 'var(--purple)' }}>
            Edit
          </button>
          <button type="button" className="pressable" onClick={() => onRemove(contact)} style={{ fontWeight: 700, color: 'var(--danger, #b42318)' }}>
            Remove
          </button>
        </div>
      ))}
      {draft ? (
        <form onSubmit={onSave} style={{ marginTop: 12 }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>
            Name
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={inputStyle} />
          </label>
          <label style={{ fontSize: 13, fontWeight: 600 }}>
            Phone
            <input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} style={inputStyle} />
          </label>
          <label style={{ fontSize: 13, fontWeight: 600 }}>
            Relationship
            <input value={draft.relationship} onChange={(e) => setDraft({ ...draft, relationship: e.target.value })} style={inputStyle} />
          </label>
          <button type="submit" className="pressable primary-cta" disabled={saving} style={{ padding: '12px 14px', borderRadius: 12, fontWeight: 700, color: '#fff', background: 'var(--orange)' }}>
            {saving ? 'Saving…' : 'Save contact'}
          </button>
          <button type="button" className="pressable" onClick={() => setDraft(null)} style={{ marginLeft: 12, fontWeight: 700, color: 'var(--purple)' }}>
            Cancel
          </button>
        </form>
      ) : contacts.length < MAX_EMERGENCY_CONTACTS ? (
        <button type="button" className="pressable" onClick={() => setDraft({ name: '', phone: '', relationship: '' })} style={{ marginTop: 10, fontWeight: 700, color: 'var(--purple)' }}>
          Add contact
        </button>
      ) : (
        <p style={{ fontSize: 12, color: 'var(--ink-tertiary)' }}>Five contacts is the limit. Edit one to change it.</p>
      )}
      {error ? <p style={{ color: 'var(--danger, #b42318)', fontSize: 13 }}>{error}</p> : null}
    </div>
  )
}
