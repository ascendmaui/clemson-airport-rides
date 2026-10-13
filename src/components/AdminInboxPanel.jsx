import { useState } from 'react'
import { INBOX_KIND_LABELS } from '../../shared/adminInbox.js'
import { runAdminInboxAction } from '../lib/adminDesk'
import { navigate } from '../lib/navigation'

export function AdminInboxPanel({ inbox, onChanged }) {
  const [busyId, setBusyId] = useState('')
  const [reasons, setReasons] = useState({})
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const items = inbox?.items || []
  const counts = inbox?.counts || {}

  async function run(item, action) {
    setError('')
    setNote('')
    const requestKey = `${item.id}:${action.id}`
    if (action.navigate && action.method === 'GET') {
      navigate(action.navigate.path, { tab: action.navigate.tab })
      return
    }
    setBusyId(requestKey)
    try {
      const data = await runAdminInboxAction(action, { reason: reasons[item.id] })
      if (data?.navigate) {
        navigate(data.navigate.path, { tab: data.navigate.tab })
        return
      }
      setNote(data?.message || `${action.label} saved`)
      await onChanged?.()
    } catch (err) {
      setError(err.message || 'Could not complete that action')
    } finally {
      setBusyId('')
    }
  }

  return (
    <section style={{ marginTop: 16 }} aria-label="Admin to-do inbox">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {Object.entries(INBOX_KIND_LABELS).map(([kind, label]) => (
          <span key={kind} style={{
            fontSize: 12,
            fontWeight: 700,
            color: counts[kind] ? '#522D80' : 'var(--ink-tertiary)',
            background: 'white',
            border: '1px solid rgba(82,45,128,0.15)',
            borderRadius: 999,
            padding: '6px 10px',
          }}>
            {label} {counts[kind] || 0}
          </span>
        ))}
      </div>
      {inbox?.migrationRequired ? (
        <p style={{ color: 'var(--ink-secondary)' }}>Some queues are not in this database yet. Apply the latest migrations and reload.</p>
      ) : null}
      {error ? <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p> : null}
      {note ? <p role="status" style={{ color: '#1d6b34' }}>{note}</p> : null}
      {items.length === 0 ? (
        <p style={{ color: 'var(--ink-secondary)' }}>Nothing is waiting. New document reviews, applicants, inspections, lost items, payout problems, failed holds, and stuck trips show up here.</p>
      ) : null}
      {items.map((item) => {
        const needsReason = item.actions.some((action) => action.needsReason)
        return (
          <article key={item.id} className="sheet" style={{ marginTop: 10, padding: 14, borderRadius: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#F56600' }}>{INBOX_KIND_LABELS[item.kind] || item.kind}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-secondary)' }}>{item.ageLabel}</div>
            </div>
            <h3 style={{ margin: '4px 0 0', fontSize: 16, color: '#522D80' }}>{item.title}</h3>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--ink-secondary)', lineHeight: 1.4 }}>{item.detail}</p>
            {needsReason ? (
              <label style={{ display: 'block', marginTop: 10, fontSize: 12, fontWeight: 700, color: '#522D80' }}>
                Reason
                <input
                  value={reasons[item.id] || ''}
                  onChange={(event) => setReasons((prev) => ({ ...prev, [item.id]: event.target.value }))}
                  style={{ display: 'block', width: '100%', marginTop: 4, minHeight: 40, borderRadius: 10, border: '1px solid rgba(82,45,128,0.2)', padding: '8px 10px' }}
                />
              </label>
            ) : null}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
              {item.actions.map((action) => {
                const requestKey = `${item.id}:${action.id}`
                return (
                  <button
                    key={action.id}
                    type="button"
                    className="pressable"
                    disabled={busyId === requestKey}
                    onClick={() => run(item, action)}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 999,
                      fontWeight: 700,
                      fontSize: 12,
                      color: action.method === 'POST' ? '#fff' : '#522D80',
                      background: action.method === 'POST' ? '#F56600' : 'white',
                      border: '1px solid rgba(82,45,128,0.15)',
                    }}
                  >
                    {busyId === requestKey ? 'Working…' : action.label}
                  </button>
                )
              })}
            </div>
          </article>
        )
      })}
    </section>
  )
}
