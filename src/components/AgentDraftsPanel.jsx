import { useEffect, useState } from 'react'
import { fetchAgentDrafts } from '../lib/adminDesk'

const FILTERS = [
  ['', 'All'],
  ['marketing', 'Marketing'],
  ['affiliate', 'Affiliate'],
  ['outreach', 'Outreach'],
]

export function AgentDraftsPanel() {
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [kind, setKind] = useState('')

  useEffect(() => {
    let alive = true
    fetchAgentDrafts()
      .then((data) => {
        if (!alive) return
        setRows(data.drafts || [])
        if (data.migrationRequired) setNotice(data.error || 'Apply the agent drafts migration.')
      })
      .catch((err) => {
        if (alive) setError(err.message || String(err))
      })
    return () => { alive = false }
  }, [])

  const visible = kind ? rows.filter((row) => row.kind === kind) : rows

  return (
    <section style={{ marginTop: 16 }}>
      <h2 style={{ fontSize: 18, color: '#522D80', margin: 0 }}>Drafts for approval</h2>
      <p style={{ color: 'var(--ink-secondary)', fontSize: 14, lineHeight: 1.45 }}>
        Marketing, affiliate, and outreach drafts waiting for John. This list does not send email.
      </p>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
        {FILTERS.map(([id, label]) => (
          <button
            key={label}
            type="button"
            className="pressable"
            onClick={() => setKind(id)}
            style={{
              flex: '0 0 auto',
              padding: '6px 10px',
              borderRadius: 999,
              fontWeight: 700,
              fontSize: 12,
              color: kind === id ? '#fff' : '#522D80',
              background: kind === id ? '#522D80' : 'white',
              border: '1px solid rgba(82,45,128,0.15)',
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {notice && <p style={{ color: 'var(--ink-secondary)' }}>{notice}</p>}
      {visible.length === 0 && <p style={{ color: 'var(--ink-secondary)' }}>No drafts waiting.</p>}
      {visible.map((row) => (
        <article key={row.id} className="sheet" style={{ marginTop: 10, padding: 14, borderRadius: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#F56600' }}>{row.kind} · {row.source}{row.slot ? ` · ${row.slot}` : ''}</div>
          <div style={{ fontWeight: 800, color: '#522D80' }}>{row.subject || 'Untitled draft'}</div>
          {row.mailbox && <div style={{ fontSize: 12, color: 'var(--ink-secondary)' }}>{row.mailbox}</div>}
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13, margin: '8px 0 0' }}>{row.body}</pre>
        </article>
      ))}
    </section>
  )
}
