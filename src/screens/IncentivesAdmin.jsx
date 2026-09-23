import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { navigate } from '../lib/navigation'
import { fetchFullProfile } from '../lib/profiles'
import { DOW_LABELS, INCENTIVE_TYPES, formatUsdFromCents, isIncentiveAdmin } from '../lib/driverIncentiveMath'
import {
  blankIncentiveForm,
  deleteIncentive,
  fetchIncentiveReport,
  incentiveToForm,
  saveIncentive,
} from '../lib/driverIncentives'

const TYPE_LABEL = {
  multiplier: 'Multiplier on driver net',
  bonus_per_ride: 'Bonus per ride',
  hourly_guarantee: 'Hourly guarantee',
}

const field = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 12,
  border: '1px solid rgba(82,45,128,0.16)',
  background: 'rgba(255,255,255,0.7)',
  color: 'var(--ink)',
}

function money(cents) {
  return formatUsdFromCents(cents || 0)
}

export function IncentivesAdmin() {
  const { user, loading } = useAuth()
  const [profile, setProfile] = useState(null)
  const [ready, setReady] = useState(false)
  const [report, setReport] = useState(null)
  const [error, setError] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(blankIncentiveForm)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState(null)

  const allowed = isIncentiveAdmin(user, profile)

  async function reload() {
    const next = await fetchIncentiveReport()
    setReport(next)
  }

  useEffect(() => {
    if (loading) return undefined
    let alive = true
    ;(async () => {
      try {
        const p = user?.id ? await fetchFullProfile(user.id, { viewerId: user.id }) : null
        if (!alive) return
        setProfile(p)
        if (isIncentiveAdmin(user, p)) await reload()
      } catch (err) {
        if (alive) setError(err.message || 'Could not load incentives')
      } finally {
        if (alive) setReady(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [loading, user])

  function editRow(row) {
    setEditingId(row.id)
    setForm(incentiveToForm(row))
    setNote(null)
  }

  function resetForm() {
    setEditingId(null)
    setForm(blankIncentiveForm())
  }

  async function onSave(event) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setNote(null)
    try {
      await saveIncentive(form, { id: editingId, createdBy: user?.id })
      setNote(editingId ? 'Window updated' : 'Window created')
      resetForm()
      await reload()
    } catch (err) {
      setError(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function onDelete(row) {
    setError(null)
    try {
      const result = await deleteIncentive(row.id)
      setNote(result.deactivated ? 'Payouts exist, so the window was turned off' : 'Window removed')
      if (editingId === row.id) resetForm()
      await reload()
    } catch (err) {
      setError(err.message || 'Could not remove window')
    }
  }

  if (loading || !ready) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-secondary)' }}>Loading…</div>
  }

  if (!allowed) {
    return (
      <div style={{ padding: 24 }}>
        <button type="button" className="pressable" onClick={() => navigate('account')} style={{ fontWeight: 700, color: 'var(--purple)' }}>
          ← Account
        </button>
        <h1 style={{ color: 'var(--purple)', marginTop: 16 }}>Driver incentives</h1>
        <p style={{ color: 'var(--ink-secondary)' }}>
          Only john@gmail.com, or a profile with admin access, can edit incentive windows.
        </p>
      </div>
    )
  }

  const totals = report?.totals

  return (
    <div className="route-fade" style={{ height: '100%', overflowY: 'auto', padding: '20px 18px 40px', background: 'var(--surface-muted)' }}>
      <button type="button" className="pressable" onClick={() => navigate('driver')} style={{ fontWeight: 700, color: 'var(--purple)' }}>
        ← Driver
      </button>
      <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--purple)', margin: '12px 0 4px' }}>Driver incentives</h1>
      <p style={{ fontSize: 13, color: 'var(--ink-secondary)', marginBottom: 14, lineHeight: 1.45 }}>
        Boosts the driver share after the 20% platform fee. A 1.5x window pays 1.5× driver net.
        Rider surge on game days is separate and is not changed here.
      </p>

      {totals && (
        <div className="glass-panel" style={{ padding: 14, borderRadius: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          <Stat label="Trips under an incentive" value={String(totals.trips)} />
          <Stat label="Extra paid to drivers" value={money(totals.extraCents)} />
          <Stat label="Drivers paid" value={String(totals.driversPaid)} />
          <Stat label="Drivers online in a window" value={String(totals.driversOnline)} />
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {(report?.rows || []).map((row) => (
          <div key={row.id} className="glass-panel" style={{ padding: 12, borderRadius: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
              <div style={{ fontWeight: 800, color: row.active ? 'var(--purple)' : 'var(--ink-tertiary)' }}>
                {row.name}{row.active ? '' : ' · off'}
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#F56600' }}>{describeValue(row)}</div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-secondary)', marginTop: 4 }}>
              {row.trips} trips · {money(row.extraCents)} extra · {row.driversPaid} paid · {row.driversOnline} online
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="button" className="pressable" onClick={() => editRow(row)} style={{ fontWeight: 700, color: 'var(--purple)' }}>Edit</button>
              <button type="button" className="pressable" onClick={() => onDelete(row)} style={{ fontWeight: 700, color: 'var(--ink-secondary)' }}>
                {row.trips ? 'Turn off' : 'Delete'}
              </button>
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={onSave} className="glass-panel" style={{ padding: 16, borderRadius: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontWeight: 800, color: 'var(--purple)' }}>{editingId ? 'Edit window' : 'New window'}</div>
        <input style={field} placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <select
          style={field}
          value={form.type}
          onChange={(e) => setForm({ ...form, type: e.target.value, value: e.target.value === 'multiplier' ? '1.5' : '5.00' })}
        >
          {INCENTIVE_TYPES.map((type) => (
            <option key={type} value={type}>{TYPE_LABEL[type]}</option>
          ))}
        </select>
        <label style={{ fontSize: 12, color: 'var(--ink-secondary)' }}>
          {form.type === 'multiplier' ? 'Multiplier (1.5 = 1.5× driver net)' : 'Dollars (bonus per ride, or per hour)'}
          <input
            style={{ ...field, marginTop: 4 }}
            inputMode="decimal"
            value={form.value}
            onChange={(e) => setForm({ ...form, value: e.target.value })}
            required
          />
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {DOW_LABELS.map((day) => {
            const on = form.days_of_week.includes(day.id)
            return (
              <button
                key={day.id}
                type="button"
                className="pressable"
                onClick={() => {
                  const next = on
                    ? form.days_of_week.filter((id) => id !== day.id)
                    : [...form.days_of_week, day.id]
                  setForm({ ...form, days_of_week: next })
                }}
                style={{
                  padding: '6px 10px',
                  borderRadius: 999,
                  fontWeight: 700,
                  fontSize: 12,
                  background: on ? '#F56600' : 'rgba(255,255,255,0.7)',
                  color: on ? '#fff' : '#522D80',
                  border: '1px solid rgba(82,45,128,0.15)',
                }}
              >
                {day.label}
              </button>
            )
          })}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <label style={{ fontSize: 12, color: 'var(--ink-secondary)' }}>
            Night start
            <input style={field} type="time" value={form.night_start} onChange={(e) => setForm({ ...form, night_start: e.target.value })} />
          </label>
          <label style={{ fontSize: 12, color: 'var(--ink-secondary)' }}>
            Night end
            <input style={field} type="time" value={form.night_end} onChange={(e) => setForm({ ...form, night_end: e.target.value })} />
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <label style={{ fontSize: 12, color: 'var(--ink-secondary)' }}>
            Starts (ET, optional)
            <input style={field} type="datetime-local" value={form.starts_local} onChange={(e) => setForm({ ...form, starts_local: e.target.value })} />
          </label>
          <label style={{ fontSize: 12, color: 'var(--ink-secondary)' }}>
            Ends (ET, optional)
            <input style={field} type="datetime-local" value={form.ends_local} onChange={(e) => setForm({ ...form, ends_local: e.target.value })} />
          </label>
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, fontWeight: 600 }}>
          <input type="checkbox" checked={form.game_day} onChange={(e) => setForm({ ...form, game_day: e.target.checked })} />
          Clemson game day (auto when a home game is on the calendar)
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, fontWeight: 600 }}>
          <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
          Active
        </label>
        <p style={{ fontSize: 12, color: 'var(--ink-tertiary)', lineHeight: 1.4 }}>
          Weeknights repeat every week inside the night hours (7pm–2am wraps past midnight).
          Leave weekdays empty and set start and end to schedule one home game or any one-off block.
        </p>
        {error && <div style={{ color: 'var(--danger)', fontWeight: 700, fontSize: 13 }}>{error}</div>}
        {note && <div style={{ color: 'var(--success)', fontWeight: 700, fontSize: 13 }}>{note}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="submit"
            className="pressable"
            disabled={saving}
            style={{
              flex: 1,
              padding: 12,
              borderRadius: 14,
              fontWeight: 800,
              color: '#fff',
              background: 'linear-gradient(135deg, #F56600, #522D80)',
            }}
          >
            {saving ? 'Saving…' : editingId ? 'Save window' : 'Create window'}
          </button>
          {editingId && (
            <button type="button" className="pressable" onClick={resetForm} style={{ padding: '12px 14px', fontWeight: 700, color: 'var(--ink-secondary)' }}>
              Cancel
            </button>
          )}
        </div>
      </form>

      {(report?.recent || []).length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 800, color: 'var(--purple)', marginBottom: 8 }}>Recent incentive payouts</div>
          {report.recent.map((payout) => (
            <div key={payout.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '6px 0', color: 'var(--ink-secondary)' }}>
              <span>{payout.incentive_type} · {String(payout.driver_id).slice(0, 8)}</span>
              <strong style={{ color: '#F56600' }}>+{money(payout.extra_cents)}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--ink-tertiary)', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--purple)' }}>{value}</div>
    </div>
  )
}

function describeValue(row) {
  switch (row.type) {
    case 'multiplier':
      return `${Number(row.value)}× driver net`
    case 'bonus_per_ride':
      return `+${money(row.value)} / ride`
    case 'hourly_guarantee':
      return `${money(row.value)}/hr`
    default: {
      const unknown = row.type
      throw new Error(`Unhandled incentive type: ${unknown}`)
    }
  }
}
