import { useEffect, useState } from 'react'
import { BottomTabs } from '../components/BottomTabs'
import { PrimaryButton } from '../components/PrimaryButton'
import { RequireAuth } from '../components/RequireAuth'
import { useAuth } from '../lib/auth'
import {
  closeLostFoundReport,
  confirmFound,
  confirmNotFound,
  createLostFoundReport,
  fetchLostFoundReport,
  fetchRecentLostFoundTrips,
  listLostFoundReports,
  markReturned,
  saveSupportNote,
  sendLostFoundMessage,
} from '../lib/lostFound'
import { resolutionLabel, statusLabel } from '../lib/lostFoundFlow'
import { getHashRoute, navigate } from '../lib/navigation'

function formatWhen(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function statusTone(status) {
  if (status === 'open') return { color: 'var(--orange)', background: 'var(--orange-soft)' }
  if (status === 'claimed') return { color: 'var(--purple)', background: 'var(--purple-soft)' }
  if (status === 'returned') return { color: 'var(--success)', background: 'rgba(31,138,76,0.12)' }
  return { color: 'var(--ink-tertiary)', background: 'var(--surface-muted)' }
}

function StatusPill({ status }) {
  const tone = statusTone(status)
  return (
    <span style={{
      display: 'inline-block',
      padding: '3px 8px',
      borderRadius: 999,
      fontSize: 12,
      fontWeight: 700,
      color: tone.color,
      background: tone.background,
    }}>
      {statusLabel(status)}
    </span>
  )
}

function withWhom(report, userId) {
  if (report.reporterId === userId) return report.counterpartFirstName
  if (report.counterpartId === userId) return report.reporterFirstName
  return `${report.reporterFirstName} · ${report.counterpartFirstName}`
}

const backBtn = {
  fontSize: 20, marginBottom: 12, width: 44, height: 44, borderRadius: 14,
  background: 'var(--surface)', boxShadow: 'var(--shadow-pill)',
}

const fieldStyle = {
  width: '100%',
  padding: 12,
  borderRadius: 14,
  border: '1px solid var(--border)',
  background: 'rgba(255,255,255,0.72)',
  font: 'inherit',
  color: 'var(--ink)',
}

function Shell({ children, onBack }) {
  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <div style={{ flex: 1, overflow: 'auto', padding: '20px 20px 96px' }}>
        <button type="button" className="pressable" onClick={onBack} style={backBtn} aria-label="Back">←</button>
        {children}
      </div>
      <BottomTabs active="account" onChange={(id) => navigate(id === 'home' ? 'home' : id)} />
    </div>
  )
}

function ReportLog({ userId, onOpen }) {
  const [rows, setRows] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    listLostFoundReports(userId)
      .then((list) => { if (alive) setRows(list) })
      .catch((e) => { if (alive) setError(e.message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [userId])

  return (
    <>
      <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--purple)', letterSpacing: -0.4 }}>Lost & found</h1>
      <p style={{ color: 'var(--ink-secondary)', marginTop: 6, lineHeight: 1.45, fontSize: 14 }}>
        Report something left in the vehicle after a ride. We show first names only, and we leave exact addresses off this screen.
      </p>
      <div style={{ marginTop: 16 }}>
        <PrimaryButton onClick={() => navigate('lost-found', { compose: '1' })}>Report an item</PrimaryButton>
      </div>
      <button
        type="button"
        className="pressable"
        onClick={() => navigate('history')}
        style={{ marginTop: 10, fontWeight: 700, color: 'var(--purple)', padding: '8px 0' }}
      >
        Pick a ride from history →
      </button>
      {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 12 }}>{error}</p>}
      {loading && <p style={{ color: 'var(--ink-tertiary)', marginTop: 16 }}>Loading reports…</p>}
      {!loading && rows.length === 0 && !error && (
        <div className="glass-panel" style={{ marginTop: 16, padding: 16, borderRadius: 18 }}>
          <div style={{ fontWeight: 700, color: 'var(--purple)' }}>No reports yet</div>
          <p style={{ fontSize: 13, color: 'var(--ink-secondary)', marginTop: 6, lineHeight: 1.45 }}>
            After a completed ride, describe the item and we’ll notify the other person.
          </p>
        </div>
      )}
      {rows.length > 0 && (
        <div className="glass-panel" style={{ marginTop: 16, borderRadius: 18, overflow: 'auto' }} data-testid="lost-found-log">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 420 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--ink-tertiary)' }}>
                {['Item', 'Ride', 'With', 'Status', 'Opened'].map((h) => (
                  <th key={h} style={{ padding: '12px 10px', fontWeight: 700, borderBottom: '1px solid var(--border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => onOpen(row.id)}
                  style={{ cursor: 'pointer' }}
                  data-testid={`lost-found-row-${row.status}`}
                >
                  <td style={{ padding: '12px 10px', fontWeight: 700, color: 'var(--ink)', maxWidth: 140 }}>{row.itemDescription}</td>
                  <td style={{ padding: '12px 10px', color: 'var(--ink-secondary)' }}>{row.pickup} → {row.dropoff}</td>
                  <td style={{ padding: '12px 10px' }}>{withWhom(row, userId)}</td>
                  <td style={{ padding: '12px 10px' }}><StatusPill status={row.status} /></td>
                  <td style={{ padding: '12px 10px', color: 'var(--ink-tertiary)', whiteSpace: 'nowrap' }}>{formatWhen(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function ComposeReport({ userId, presetTripId }) {
  const [step, setStep] = useState('describe')
  const [description, setDescription] = useState('')
  const [trips, setTrips] = useState([])
  const [tripId, setTripId] = useState(presetTripId || '')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetchRecentLostFoundTrips(userId)
      .then((list) => {
        if (!alive) return
        setTrips(list)
        if (presetTripId && list.some((t) => t.id === presetTripId)) setTripId(presetTripId)
        else if (!presetTripId && list[0]) setTripId(list[0].id)
      })
      .catch((e) => { if (alive) setError(e.message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [userId, presetTripId])

  const selected = trips.find((t) => t.id === tripId) || null

  async function onNotify() {
    if (!selected?.otherId) {
      setError('Choose a completed ride with a driver.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const created = await createLostFoundReport({
        tripId: selected.id,
        reporterId: userId,
        counterpartId: selected.otherId,
        description,
      })
      navigate('lost-found', { id: created.id })
    } catch (e) {
      setError(e.message || 'Could not send the report')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div style={{ fontSize: 12, letterSpacing: 1.2, fontWeight: 800, color: 'var(--orange)' }}>LOST & FOUND</div>
      <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--purple)', marginTop: 4 }}>Report an item</h1>
      <p style={{ color: 'var(--ink-secondary)', fontSize: 14, marginTop: 6, lineHeight: 1.45 }}>
        Describe it, match the ride, then we notify the other person. First names only.
      </p>

      {step === 'describe' && (
        <div className="glass-panel" style={{ marginTop: 16, padding: 16, borderRadius: 18 }} data-testid="lost-found-describe">
          <label htmlFor="lf-item" style={{ fontWeight: 700, color: 'var(--purple)' }}>What was left behind?</label>
          <textarea
            id="lf-item"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            maxLength={400}
            placeholder="Black water bottle, orange lanyard…"
            style={{ ...fieldStyle, marginTop: 8 }}
          />
          <div style={{ marginTop: 14 }}>
            <PrimaryButton
              disabled={description.trim().length < 2}
              onClick={() => setStep('pick')}
            >
              Choose the ride
            </PrimaryButton>
          </div>
        </div>
      )}

      {step === 'pick' && (
        <div className="glass-panel" style={{ marginTop: 16, padding: 16, borderRadius: 18 }} data-testid="lost-found-picker">
          <div style={{ fontWeight: 700, color: 'var(--purple)', marginBottom: 8 }}>Recent completed rides</div>
          {loading && <p style={{ color: 'var(--ink-tertiary)' }}>Loading rides…</p>}
          {!loading && trips.length === 0 && (
            <p style={{ color: 'var(--ink-secondary)', fontSize: 14, lineHeight: 1.45 }}>
              No completed rides yet. Lost and found opens after a trip is completed with a driver.
            </p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {trips.map((t) => {
              const on = t.id === tripId
              return (
                <button
                  key={t.id}
                  type="button"
                  className="pressable"
                  onClick={() => setTripId(t.id)}
                  style={{
                    textAlign: 'left',
                    padding: 12,
                    borderRadius: 14,
                    background: on ? 'rgba(82,45,128,0.12)' : 'rgba(255,255,255,0.55)',
                    border: on ? '1.5px solid var(--purple)' : '1px solid rgba(82,45,128,0.1)',
                  }}
                >
                  <div style={{ fontWeight: 700 }}>{t.pickup} → {t.dropoff}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-tertiary)', marginTop: 4 }}>
                    {formatWhen(t.completedAt)} · {t.otherRole === 'driver' ? 'Driver' : 'Rider'} {t.otherFirstName}
                  </div>
                </button>
              )
            })}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
            <PrimaryButton disabled={!selected} onClick={() => setStep('confirm')}>Continue</PrimaryButton>
            <button type="button" className="pressable" onClick={() => setStep('describe')} style={{ fontWeight: 600, color: 'var(--ink-secondary)', padding: 10 }}>
              Back to description
            </button>
          </div>
        </div>
      )}

      {step === 'confirm' && selected && (
        <div className="glass-panel" style={{ marginTop: 16, padding: 16, borderRadius: 18 }} data-testid="lost-found-confirm">
          <div style={{ fontWeight: 700, color: 'var(--purple)' }}>Notify {selected.otherFirstName}</div>
          <p style={{ fontSize: 14, color: 'var(--ink-secondary)', marginTop: 8, lineHeight: 1.45 }}>
            “{description.trim()}” on {selected.pickup} → {selected.dropoff} ({formatWhen(selected.completedAt)}).
            They can mark it found or not found.
          </p>
          {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 10 }}>{error}</p>}
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <PrimaryButton disabled={busy} onClick={onNotify}>
              {busy ? 'Notifying…' : `Notify ${selected.otherFirstName}`}
            </PrimaryButton>
            <button type="button" className="pressable" onClick={() => setStep('pick')} style={{ fontWeight: 600, color: 'var(--ink-secondary)', padding: 10 }}>
              Choose a different ride
            </button>
          </div>
        </div>
      )}
      {error && step !== 'confirm' && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 12 }}>{error}</p>}
    </>
  )
}

function ReportDetail({ reportId, userId }) {
  const [report, setReport] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [message, setMessage] = useState('')

  async function reload() {
    const next = await fetchLostFoundReport(reportId, userId)
    setReport(next)
    setNote(next?.supportNote || '')
  }

  useEffect(() => {
    let alive = true
    fetchLostFoundReport(reportId, userId)
      .then((next) => {
        if (!alive) return
        setReport(next)
        setNote(next?.supportNote || '')
      })
      .catch((e) => { if (alive) setError(e.message) })
    return () => { alive = false }
  }, [reportId, userId])

  async function run(action) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await reload()
    } catch (e) {
      setError(e.message || 'Could not update the report')
    } finally {
      setBusy(false)
    }
  }

  if (!report && !error) return <p style={{ color: 'var(--ink-tertiary)' }}>Loading report…</p>
  if (!report) return <p style={{ color: 'var(--danger)' }}>{error || 'Report not found'}</p>

  const choices = report.choices
  const otherName = report.mine ? report.counterpartFirstName : report.reporterFirstName
  const events = [
    { label: 'Opened', at: report.createdAt },
    report.claimedAt ? { label: 'Claimed', at: report.claimedAt } : null,
    report.returnedAt ? { label: 'Returned', at: report.returnedAt } : null,
    report.closedAt ? { label: 'Closed', at: report.closedAt } : null,
  ].filter(Boolean)

  return (
    <div data-testid="lost-found-detail">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--purple)' }}>{report.itemDescription}</h1>
        <StatusPill status={report.status} />
      </div>
      <p style={{ color: 'var(--ink-secondary)', marginTop: 8, fontSize: 14 }}>
        {report.pickup} → {report.dropoff}
        {report.completedAt ? ` · ${formatWhen(report.completedAt)}` : ''}
      </p>
      <p style={{ fontSize: 14, marginTop: 4 }}>
        {report.mine ? `You reported this to ${otherName}` : `${report.reporterFirstName} reported this to you`}
        {report.resolution ? ` · ${resolutionLabel(report.resolution)}` : ''}
      </p>

      <div className="glass-panel" style={{ marginTop: 14, padding: 14, borderRadius: 16 }}>
        <div style={{ fontWeight: 700, color: 'var(--purple)', marginBottom: 8 }}>Status log</div>
        {events.map((ev) => (
          <div key={ev.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
            <span>{ev.label}</span>
            <span style={{ color: 'var(--ink-tertiary)' }}>{formatWhen(ev.at)}</span>
          </div>
        ))}
      </div>

      {choices.canConfirmFound && (
        <div className="glass-panel" style={{ marginTop: 14, padding: 14, borderRadius: 16 }} data-testid="lost-found-claim">
          <div style={{ fontWeight: 700, color: 'var(--purple)' }}>Did you find it?</div>
          <p style={{ fontSize: 13, color: 'var(--ink-secondary)', margin: '6px 0 12px', lineHeight: 1.45 }}>
            Confirm for {report.reporterFirstName}. If you found it, you’ll arrange the return here.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <PrimaryButton disabled={busy} onClick={() => run(() => confirmFound(report.id))}>Found it</PrimaryButton>
            <button
              type="button"
              className="pressable"
              disabled={busy}
              onClick={() => run(() => confirmNotFound(report.id))}
              style={{ padding: 12, fontWeight: 700, color: 'var(--ink-secondary)' }}
            >
              Not found
            </button>
          </div>
        </div>
      )}

      {(choices.canMessage || report.messages?.length > 0) && (
        <div className="glass-panel" style={{ marginTop: 14, padding: 14, borderRadius: 16 }} data-testid="lost-found-return">
          <div style={{ fontWeight: 700, color: 'var(--purple)' }}>Arrange the return</div>
          {report.hasRideChat ? (
            <button
              type="button"
              className="pressable"
              onClick={() => navigate('requested', { trip: report.tripId })}
              style={{ marginTop: 8, fontWeight: 700, color: 'var(--purple)' }}
            >
              Open ride chat
            </button>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--ink-secondary)', marginTop: 6, lineHeight: 1.45 }}>
              This trip has no ride chat. Message {otherName} here, or leave a support note for the campus team.
            </p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            {(report.messages || []).map((m) => (
              <div key={m.id} style={{
                alignSelf: m.mine ? 'flex-end' : 'flex-start',
                maxWidth: '90%',
                padding: '8px 12px',
                borderRadius: 14,
                background: m.mine ? 'rgba(245,102,0,0.14)' : 'rgba(82,45,128,0.1)',
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-tertiary)' }}>{m.senderFirstName}</div>
                <div style={{ fontSize: 14 }}>{m.body}</div>
              </div>
            ))}
          </div>
          {choices.canMessage && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const text = message
                run(async () => {
                  await sendLostFoundMessage({ reportId: report.id, senderId: userId, body: text })
                  setMessage('')
                })
              }}
              style={{ marginTop: 10 }}
            >
              <label htmlFor="lf-msg" className="sr-only" style={{ position: 'absolute', left: -9999 }}>Message</label>
              <textarea
                id="lf-msg"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={2}
                placeholder={`Message ${otherName} about pickup`}
                style={fieldStyle}
              />
              <div style={{ marginTop: 8 }}>
                <PrimaryButton type="submit" disabled={busy || !message.trim()} variant="purple">Send</PrimaryButton>
              </div>
            </form>
          )}
          {choices.canMarkReturned && (
            <div style={{ marginTop: 10 }}>
              <PrimaryButton disabled={busy} onClick={() => run(() => markReturned(report.id))}>Mark returned</PrimaryButton>
            </div>
          )}
        </div>
      )}

      {choices.canSupportNote && (
        <div className="glass-panel" style={{ marginTop: 14, padding: 14, borderRadius: 16 }}>
          <label htmlFor="lf-note" style={{ fontWeight: 700, color: 'var(--purple)' }}>Support note</label>
          <textarea
            id="lf-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="Where to meet on campus, or what support should know"
            style={{ ...fieldStyle, marginTop: 8 }}
          />
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              className="pressable"
              disabled={busy}
              onClick={() => run(() => saveSupportNote(report.id, note))}
              style={{ fontWeight: 700, color: 'var(--purple)', padding: '8px 0' }}
            >
              Save support note
            </button>
          </div>
        </div>
      )}

      {!choices.canSupportNote && report.supportNote && (
        <div className="glass-panel" style={{ marginTop: 14, padding: 14, borderRadius: 16 }}>
          <div style={{ fontWeight: 700, color: 'var(--purple)' }}>Support note</div>
          <p style={{ fontSize: 14, marginTop: 6 }}>{report.supportNote}</p>
        </div>
      )}

      {(choices.canClose || choices.canWithdraw) && (
        <button
          type="button"
          className="pressable"
          disabled={busy}
          onClick={() => run(() => closeLostFoundReport(report.id))}
          style={{ marginTop: 14, width: '100%', padding: 12, fontWeight: 700, color: 'var(--ink-tertiary)' }}
        >
          {choices.canWithdraw ? 'Withdraw report' : 'Close report'}
        </button>
      )}

      {report.status === 'closed' && (
        <p style={{ marginTop: 14, fontSize: 14, color: 'var(--ink-secondary)' }} data-testid="lost-found-closed">
          {report.resolution === 'not_found'
            ? `${otherName} marked this not found. The report is closed.`
            : 'This report is closed.'}
        </p>
      )}
      {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 12 }}>{error}</p>}
    </div>
  )
}

function LostFoundInner() {
  const { user } = useAuth()
  const { params } = getHashRoute()
  if (!user?.id) return null
  const reportId = params.id || ''
  const presetTripId = params.trip || ''
  const composing = !reportId && Boolean(params.compose || presetTripId)

  let body = <ReportLog userId={user.id} onOpen={(id) => navigate('lost-found', { id })} />
  if (reportId) body = <ReportDetail reportId={reportId} userId={user.id} />
  else if (composing) body = <ComposeReport userId={user.id} presetTripId={presetTripId} />

  const onBack = () => {
    if (reportId || composing) navigate('lost-found')
    else navigate('account')
  }

  return <Shell onBack={onBack}>{body}</Shell>
}

export function LostFound() {
  return (
    <RequireAuth>
      <LostFoundInner />
    </RequireAuth>
  )
}
