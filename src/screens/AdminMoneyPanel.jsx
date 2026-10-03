import { useEffect, useState } from 'react'
import { confirmAdminMoney, fetchAdminPeople, previewAdminMoney } from '../lib/adminDesk'

const ACTIONS = [
  ['refund', 'Refund'],
  ['credit', 'Credit'],
  ['incentive', 'Incentive'],
]

function dollarsToCents(raw) {
  const text = String(raw ?? '').trim()
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null
  const [whole, frac = ''] = text.split('.')
  const cents = (Number(whole) * 100) + Number((`${frac}00`).slice(0, 2))
  if (!Number.isSafeInteger(cents) || cents < 1) return null
  return cents
}

function roleOf(person) {
  const role = String(person?.role || '').trim().toLowerCase()
  if (role === 'driver') return 'driver'
  if (role === 'rider' || role === '') return 'rider'
  return null
}

function peopleFor(action, people) {
  return people.filter((person) => {
    const role = roleOf(person)
    if (role !== 'rider' && role !== 'driver') return false
    if (action === 'refund') return role === 'rider'
    return true
  })
}

const field = {
  width: '100%',
  marginTop: 6,
  padding: '10px 12px',
  borderRadius: 12,
  border: '1px solid rgba(82,45,128,0.16)',
  background: 'white',
  color: 'var(--ink)',
}

export function AdminMoneyPanel() {
  const [action, setAction] = useState('refund')
  const [people, setPeople] = useState([])
  const [profileId, setProfileId] = useState('')
  const [dollars, setDollars] = useState('')
  const [tripId, setTripId] = useState('')
  const [note, setNote] = useState('')
  const [preview, setPreview] = useState(null)
  const [requestId, setRequestId] = useState('')
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    fetchAdminPeople('')
      .then((data) => {
        if (alive) setPeople(data.people || [])
      })
      .catch((err) => {
        if (alive) setError(err.message || String(err))
      })
    return () => {
      alive = false
    }
  }, [])

  const choices = peopleFor(action, people)
  const selected = choices.find((person) => person.id === profileId) || null

  function clearReview() {
    setPreview(null)
    setRequestId('')
    setResult('')
  }

  function chooseAction(next) {
    setAction(next)
    setProfileId('')
    setTripId('')
    clearReview()
    setError('')
  }

  async function review(event) {
    event.preventDefault()
    setError('')
    setResult('')
    setPreview(null)
    const amountCents = dollarsToCents(dollars)
    if (!selected) {
      setError('Choose the rider or driver this action affects.')
      return
    }
    if (amountCents == null) {
      setError('Enter an amount in dollars, such as 12.50.')
      return
    }
    setBusy(true)
    try {
      const data = await previewAdminMoney(action, {
        profileId: selected.id,
        amountCents,
        tripId: action === 'refund' ? tripId.trim() : '',
        note: note.trim(),
      })
      setPreview(data)
      setRequestId(crypto.randomUUID())
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    if (!preview || !requestId) return
    setBusy(true)
    setError('')
    try {
      const data = await confirmAdminMoney(action, {
        profileId: preview.person?.id,
        amountCents: preview.amountCents,
        tripId: action === 'refund' ? tripId.trim() : '',
        note: note.trim(),
        requestId,
      })
      setResult(data.result || data.confirmation || 'Recorded.')
      setPreview(null)
      setRequestId('')
      setDollars('')
      setNote('')
      setTripId('')
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section style={{ marginTop: 16 }}>
      <h2 style={{ fontSize: 18, color: '#522D80', margin: 0 }}>Refunds, credits, and incentives</h2>
      <p style={{ fontSize: 13, color: 'var(--ink-secondary)', lineHeight: 1.45 }}>
        Review shows who is affected and the amount. Nothing is refunded, credited, or recorded until you confirm.
        This does not charge a card.
      </p>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        {ACTIONS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className="pressable"
            onClick={() => chooseAction(id)}
            style={{
              padding: '8px 12px',
              borderRadius: 999,
              fontWeight: 700,
              fontSize: 12,
              color: action === id ? '#fff' : '#522D80',
              background: action === id ? '#522D80' : 'white',
              border: '1px solid rgba(82,45,128,0.15)',
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <form onSubmit={review} style={{ marginTop: 14 }}>
        <label htmlFor="admin-money-person" style={{ fontSize: 13, fontWeight: 700, color: '#522D80' }}>
          Who
          <select
            id="admin-money-person"
            value={profileId}
            onChange={(event) => {
              setProfileId(event.target.value)
              clearReview()
            }}
            style={field}
          >
            <option value="">Choose a person</option>
            {choices.map((person) => (
              <option key={person.id} value={person.id}>
                {(person.full_name || 'No name')} · {person.email || 'no email'} · {roleOf(person)}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="admin-money-amount" style={{ display: 'block', marginTop: 12, fontSize: 13, fontWeight: 700, color: '#522D80' }}>
          Amount in dollars
          <input
            id="admin-money-amount"
            inputMode="decimal"
            value={dollars}
            onChange={(event) => {
              setDollars(event.target.value)
              clearReview()
            }}
            placeholder="12.50"
            style={field}
          />
        </label>
        {action === 'refund' && (
          <label htmlFor="admin-money-trip" style={{ display: 'block', marginTop: 12, fontSize: 13, fontWeight: 700, color: '#522D80' }}>
            Trip id, optional
            <input
              id="admin-money-trip"
              value={tripId}
              onChange={(event) => {
                setTripId(event.target.value)
                clearReview()
              }}
              placeholder="Limit the refund to one trip"
              style={field}
            />
          </label>
        )}
        <label htmlFor="admin-money-note" style={{ display: 'block', marginTop: 12, fontSize: 13, fontWeight: 700, color: '#522D80' }}>
          Note, optional
          <input
            id="admin-money-note"
            value={note}
            onChange={(event) => {
              setNote(event.target.value)
              clearReview()
            }}
            maxLength={280}
            style={field}
          />
        </label>
        <button
          type="submit"
          className="pressable"
          disabled={busy}
          style={{
            marginTop: 14,
            padding: '10px 14px',
            borderRadius: 12,
            fontWeight: 800,
            color: '#522D80',
            background: 'white',
            border: '1px solid rgba(82,45,128,0.25)',
          }}
        >
          {busy && !preview ? 'Reviewing…' : 'Review'}
        </button>
      </form>
      {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
      {result && (
        <p role="status" style={{ marginTop: 12, padding: 12, borderRadius: 12, background: 'white', color: '#522D80', fontWeight: 700 }}>
          {result}
        </p>
      )}
      {preview && (
        <div role="region" aria-label="Confirm money action" className="sheet" style={{ marginTop: 14, padding: 14, borderRadius: 16 }}>
          <p style={{ marginTop: 0, fontWeight: 700, color: '#522D80', lineHeight: 1.45 }}>{preview.confirmation}</p>
          <dl style={{ margin: '8px 0', fontSize: 14 }}>
            <dt style={{ fontWeight: 800, color: '#522D80' }}>Who</dt>
            <dd style={{ margin: '0 0 8px' }}>
              {preview.person?.fullName || 'No name'} · {preview.person?.email || 'no email'} · {preview.person?.role}
            </dd>
            <dt style={{ fontWeight: 800, color: '#522D80' }}>Amount</dt>
            <dd style={{ margin: '0 0 8px' }}>{preview.amountLabel}</dd>
            <dt style={{ fontWeight: 800, color: '#522D80' }}>What happens</dt>
            <dd style={{ margin: 0 }}>{preview.settlementLabel}</dd>
          </dl>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button
              type="button"
              className="pressable"
              disabled={busy}
              onClick={confirm}
              style={{
                padding: '10px 14px',
                borderRadius: 12,
                fontWeight: 800,
                color: '#fff',
                background: '#F56600',
                border: '1px solid #F56600',
              }}
            >
              {busy ? 'Working…' : `Confirm ${action}`}
            </button>
            <button
              type="button"
              className="pressable"
              disabled={busy}
              onClick={() => {
                setPreview(null)
                setRequestId('')
              }}
              style={{
                padding: '10px 14px',
                borderRadius: 12,
                fontWeight: 800,
                color: '#522D80',
                background: 'white',
                border: '1px solid rgba(82,45,128,0.25)',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
