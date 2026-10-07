import { useState } from 'react'
import { canOpenLostItemReport, tripPartyRole } from '../lib/tripChatRules'
import { notifyLostItemReport, openLostItemReport } from '../lib/tripMessages'

export function ReportLostItemButton({ trip, userId, onOpened }) {
  const role = tripPartyRole(trip, userId)
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  if (!trip?.id || !role || !canOpenLostItemReport(trip, Date.now(), role)) return null
  const label = role === 'driver' ? 'Report a lost item' : 'I lost an item'

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const created = await openLostItemReport({ tripId: trip.id, description: note })
      if (created?.id) await notifyLostItemReport({ tripId: trip.id, reportId: created.id })
      setOpen(false)
      setNote('')
      onOpened?.(created)
    } catch (err) {
      setError(err.message || 'Could not open the lost-item thread')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="pressable"
        data-testid="report-lost-item"
        onClick={() => setOpen(true)}
        style={{ fontWeight: 800, color: 'var(--orange)', minHeight: 44, textAlign: 'left' }}
      >
        {label}
      </button>
    )
  }

  return (
    <form onSubmit={submit} data-testid="report-lost-item-form" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label style={{ fontSize: 13, color: 'var(--ink-secondary)', fontWeight: 600 }}>
        Optional note
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={80}
          placeholder="black backpack"
          aria-label="Lost item description"
          style={{
            display: 'block',
            width: '100%',
            marginTop: 6,
            minHeight: 44,
            borderRadius: 12,
            border: '1px solid var(--border)',
            padding: '0 12px',
            background: 'var(--surface)',
            color: 'var(--ink)',
          }}
        />
      </label>
      <button
        type="submit"
        className="pressable"
        disabled={busy}
        style={{
          minHeight: 48,
          borderRadius: 14,
          background: '#F56600',
          color: '#fff',
          fontWeight: 800,
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? 'Sending…' : label}
      </button>
      {error ? <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p> : null}
    </form>
  )
}
