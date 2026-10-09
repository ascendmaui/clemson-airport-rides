import { useRef, useState } from 'react'
import { driverCancelTrip } from '../../packages/rides-native/driverDesk.js'
import { DRIVER_CANCEL_NOTICE, DRIVER_CANCEL_REASONS, validateDriverCancel } from '../../shared/driverCancel.js'
import { A11yModalDialog } from './A11yModal'
import { AccessibleAlert } from './AccessibleAlert'

export function DriverCancelSheet({ supabase, tripId, disabled, onCanceled }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const sending = useRef(false)
  async function confirm(event) {
    event.preventDefault()
    if (sending.current) return
    const invalid = validateDriverCancel(reason, reason === 'other' ? note : undefined)
    if (invalid) { setError(invalid); return }
    sending.current = true
    setBusy(true)
    setError(null)
    try {
      await driverCancelTrip(supabase, tripId, reason, reason === 'other' ? note.trim() : undefined)
    } catch (err) {
      setError(err.message || 'Could not cancel this trip. Try again.')
      sending.current = false
      setBusy(false)
      return
    }
    setOpen(false)
    onCanceled()
  }
  return <>
    <button type="button" disabled={disabled || busy} className="pressable" style={{ color: 'var(--danger)', minHeight: 44 }} onClick={() => setOpen(true)}>Cancel trip</button>
    <A11yModalDialog open={open} titleId="driver-cancel-title" onClose={() => { if (!busy) setOpen(false) }} style={{ padding: 24, maxWidth: 420, width: '100%' }}>
      <form onSubmit={confirm}>
        <h2 id="driver-cancel-title">Cancel trip</h2>
        <p>{DRIVER_CANCEL_NOTICE}</p>
        <label htmlFor="driver-cancel-reason">Reason</label>
        <select id="driver-cancel-reason" required value={reason} disabled={busy} onChange={(event) => { setReason(event.target.value); setError(null) }} style={{ width: '100%', minHeight: 44, marginBottom: 12 }}>
          <option value="">Choose a reason</option>
          {DRIVER_CANCEL_REASONS.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}
        </select>
        {reason === 'other' && <>
          <label htmlFor="driver-cancel-note">Note (required, up to 200 characters)</label>
          <textarea id="driver-cancel-note" required maxLength={200} value={note} disabled={busy} onChange={(event) => setNote(event.target.value)} style={{ width: '100%', minHeight: 80 }} />
        </>}
        {error && <AccessibleAlert error={error} />}
        <button type="submit" disabled={busy || disabled || !reason || (reason === 'other' && !note.trim())} className="pressable" style={{ minHeight: 44, color: 'var(--danger)' }}>{busy ? 'Canceling…' : 'Confirm cancellation'}</button>
        <button type="button" disabled={busy} className="pressable" style={{ minHeight: 44 }} onClick={() => setOpen(false)}>Keep trip</button>
      </form>
    </A11yModalDialog>
  </>
}
