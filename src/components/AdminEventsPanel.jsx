import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { EVENT_KINDS, EVENT_KIND_LABELS } from '../../shared/campusEvents.js'

const COLUMNS = 'id, kind, title, event_date, ends_on, starts_at, zone, demand_weight, notes, source, source_url, active, driver_bonus_cents, bonus_starts_at, bonus_ends_at, nudge_lead_hours, nudge_sent_at'
const ZONES = ['stadium', 'campus', 'downtown', 'gsp', 'clt', 'atl']
const BLANK = { kind: 'campus_event', title: '', event_date: '', ends_on: '', starts_at: '', zone: 'campus', demand_weight: 1.5, notes: '', source_url: '', active: true, driver_bonus_cents: 0, bonus_starts_at: '', bonus_ends_at: '', nudge_lead_hours: 24 }

function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Row payload for clemson_events from the form. Exported for tests. */
export function eventPayload(form) {
  const iso = (v) => (v ? new Date(v).toISOString() : null)
  return {
    kind: form.kind,
    title: String(form.title || '').trim(),
    event_date: form.event_date,
    ends_on: form.ends_on || null,
    starts_at: iso(form.starts_at),
    zone: form.zone,
    demand_weight: Number(form.demand_weight) || 1,
    notes: form.notes || null,
    source_url: form.source_url || null,
    active: Boolean(form.active),
    driver_bonus_cents: Math.max(0, Math.round(Number(form.driver_bonus_cents) || 0)),
    bonus_starts_at: iso(form.bonus_starts_at),
    bonus_ends_at: iso(form.bonus_ends_at),
    nudge_lead_hours: Math.max(1, Math.min(168, Math.round(Number(form.nudge_lead_hours) || 24))),
  }
}

/** Admin: Clemson calendar (driver nudges, bonus window, forecast weight). RLS: is_admin() writes. */
export function AdminEventsPanel() {
  const [rows, setRows] = useState([])
  const [form, setForm] = useState(BLANK)
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')
  const load = () => {
    if (!supabase) return
    supabase.from('clemson_events').select(COLUMNS).order('event_date', { ascending: true })
      .then(({ data, error: err }) => { if (err) setError(err.message); else setRows(data || []) })
  }
  useEffect(load, [])
  const save = async (event) => {
    event.preventDefault()
    setError('')
    const payload = eventPayload(form)
    const q = editing ? supabase.from('clemson_events').update(payload).eq('id', editing) : supabase.from('clemson_events').insert(payload)
    const { error: err } = await q
    if (err) { setError(err.message); return }
    setForm(BLANK); setEditing(null); load()
  }
  const edit = (row) => {
    setEditing(row.id)
    setForm({ ...BLANK, ...row, ends_on: row.ends_on || '', notes: row.notes || '', source_url: row.source_url || '', starts_at: toLocalInput(row.starts_at), bonus_starts_at: toLocalInput(row.bonus_starts_at), bonus_ends_at: toLocalInput(row.bonus_ends_at) })
  }
  const remove = async (row) => {
    if (!window.confirm(`Delete "${row.title}"?`)) return
    const { error: err } = await supabase.from('clemson_events').delete().eq('id', row.id)
    if (err) setError(err.message); else load()
  }
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const field = { display: 'grid', gap: 4, fontSize: 12, color: '#522D80' }
  return (
    <section style={{ marginTop: 16 }}>
      <p style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>
        Events shift driver supply only: a pre-event driver push, an optional driver bonus window, and the forecast weight. Rider fares never change.
        Add only dates confirmed on an official Clemson page and paste the link. Bonus payouts are not wired yet; keep the bonus at 0 until they are.
      </p>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      <form onSubmit={save} className="sheet" style={{ padding: 14, borderRadius: 16, display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <label style={field}>Kind<select value={form.kind} onChange={set('kind')}>{EVENT_KINDS.map((k) => <option key={k} value={k}>{EVENT_KIND_LABELS[k]}</option>)}</select></label>
        <label style={field}>Title<input required value={form.title} onChange={set('title')} /></label>
        <label style={field}>Date<input required type="date" value={form.event_date} onChange={set('event_date')} /></label>
        <label style={field}>Ends on<input type="date" value={form.ends_on} onChange={set('ends_on')} /></label>
        <label style={field}>Starts at<input type="datetime-local" value={form.starts_at} onChange={set('starts_at')} /></label>
        <label style={field}>Zone<select value={form.zone} onChange={set('zone')}>{ZONES.map((z) => <option key={z}>{z}</option>)}</select></label>
        <label style={field}>Demand weight<input type="number" step="0.1" min="0.1" max="5" value={form.demand_weight} onChange={set('demand_weight')} /></label>
        <label style={field}>Nudge lead (hours)<input type="number" min="1" max="168" value={form.nudge_lead_hours} onChange={set('nudge_lead_hours')} /></label>
        <label style={field}>Driver bonus (cents/trip)<input type="number" min="0" max="2000" value={form.driver_bonus_cents} onChange={set('driver_bonus_cents')} /></label>
        <label style={field}>Bonus starts<input type="datetime-local" value={form.bonus_starts_at} onChange={set('bonus_starts_at')} /></label>
        <label style={field}>Bonus ends<input type="datetime-local" value={form.bonus_ends_at} onChange={set('bonus_ends_at')} /></label>
        <label style={field}>Official source URL<input type="url" value={form.source_url} onChange={set('source_url')} /></label>
        <label style={field}>Notes<input value={form.notes} onChange={set('notes')} /></label>
        <label style={{ ...field, alignItems: 'center' }}>Active<input type="checkbox" checked={form.active} onChange={set('active')} /></label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
          <button type="submit" className="btn">{editing ? 'Save event' : 'Add event'}</button>
          {editing && <button type="button" className="btn" onClick={() => { setEditing(null); setForm(BLANK) }}>Cancel</button>}
        </div>
      </form>
      {rows.map((row) => (
        <div key={row.id} className="sheet" style={{ marginTop: 10, padding: 14, borderRadius: 16, opacity: row.active ? 1 : 0.55 }}>
          <div style={{ fontWeight: 800, color: '#522D80' }}>{row.title}</div>
          <div style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>
            {EVENT_KIND_LABELS[row.kind] || row.kind} · {row.event_date}{row.ends_on ? ` – ${row.ends_on}` : ''} · {row.zone} · weight {row.demand_weight}
            {row.driver_bonus_cents ? ` · bonus ${row.driver_bonus_cents}¢` : ''}{row.nudge_sent_at ? ' · nudge sent' : ''}
          </div>
          {row.source_url && <a href={row.source_url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>Source</a>}
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button type="button" className="btn" onClick={() => edit(row)}>Edit</button>
            <button type="button" className="btn" onClick={() => remove(row)}>Delete</button>
          </div>
        </div>
      ))}
    </section>
  )
}
