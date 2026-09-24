import { useEffect, useState } from 'react'
import { loadApplicantInbox, replyApplicantInbox } from '../lib/applicantInbox'

export function ApplicantThread() {
  const [messages, setMessages] = useState([])
  const [requests, setRequests] = useState([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    loadApplicantInbox()
      .then((data) => {
        if (!alive) return
        setMessages(data.messages || [])
        setRequests(data.requests || [])
      })
      .catch((err) => {
        if (alive) setError(err.message || 'Could not load admin messages.')
      })
    return () => { alive = false }
  }, [])

  const openRequests = requests.filter((row) => row.status === 'open')
  if (!messages.length && !openRequests.length && !error) return null

  async function send(event) {
    event.preventDefault()
    const body = draft.trim()
    if (!body || busy) return
    setBusy(true)
    setError('')
    try {
      const data = await replyApplicantInbox(body)
      setMessages(data.messages || [])
      setRequests(data.requests || [])
      setDraft('')
    } catch (err) {
      setError(err.message || 'Could not send.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ marginTop: 16, padding: 14, borderRadius: 16, background: 'rgba(82,45,128,0.06)' }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--purple)' }}>Messages from admin</div>
      {openRequests.map((row) => (
        <p key={row.id} style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--ink)' }}>
          <strong style={{ color: '#F56600' }}>More information needed.</strong> {row.prompt}
        </p>
      ))}
      {messages.map((row) => (
        <p key={row.id} style={{ fontSize: 13, lineHeight: 1.45, margin: '8px 0' }}>
          <strong style={{ color: row.author_role === 'admin' ? '#522D80' : '#F56600' }}>
            {row.author_role === 'admin' ? 'Admin' : 'You'}
            {row.kind === 'info_request' ? ' · details requested' : ''}
          </strong>
          {' · '}
          {row.body}
        </p>
      ))}
      <form onSubmit={send} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={3}
          placeholder="Reply to the admin"
          style={{ borderRadius: 12, border: '1px solid rgba(82,45,128,0.2)', padding: 10 }}
        />
        <button
          type="submit"
          className="pressable"
          disabled={busy || !draft.trim()}
          style={{ alignSelf: 'flex-start', padding: '8px 14px', borderRadius: 12, fontWeight: 800, color: '#fff', background: '#F56600' }}
        >
          {busy ? 'Sending…' : 'Send reply'}
        </button>
      </form>
      {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
    </div>
  )
}
