import { useEffect, useState } from 'react'
import { SUPPORT_CHIPS, categoryLabel } from '../../server/agentChips.js'
import {
  ChatShell, ChipRow, Composer, MessageList, Segment, SpeechBanner, openAction,
} from './chatChrome'
import { useAssistChat } from '../lib/useAssistChat'
import { supportTicketRequest } from '../lib/agentChatClient'

function welcome(role) {
  if (role === 'driver') {
    return 'Driver Support is for problems: you cannot go online, a fare looks wrong, a rider dispute, a bug, or a safety concern. I will draft a ticket and file it only after you confirm. How-to questions belong in Help.'
  }
  return 'Support is for problems: a charge, a ride dispute, a bug, account access, or safety. I will draft a ticket and file it only after you confirm. How-to questions belong in Help.'
}

function mailtoFor(draft) {
  const subject = encodeURIComponent(draft?.subject || 'Clemson RIDES support')
  const body = encodeURIComponent(draft?.body || '')
  return `mailto:rides@clemson.edu?subject=${subject}&body=${body}`
}

export function SupportChatPanel({ accountRole = null, active = true }) {
  const chat = useAssistChat({
    scope: 'support',
    endpoint: '/api/admin-drivers?action=support-chat',
    accountRole,
    welcome,
    active,
  })
  const [tickets, setTickets] = useState([])
  const [listNote, setListNote] = useState('')
  const [filing, setFiling] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [reload, setReload] = useState(0)
  const chips = SUPPORT_CHIPS[chat.roleVariant] || SUPPORT_CHIPS.rider

  useEffect(() => {
    if (!active) return undefined
    let alive = true
    supportTicketRequest('/api/admin-drivers?action=ticket')
      .then((data) => {
        if (!alive) return
        setTickets(data.tickets || [])
        setIsAdmin(Boolean(data.isAdmin))
        setListNote('')
      })
      .catch((error) => {
        if (!alive) return
        setListNote(error.message || 'Tickets could not be loaded.')
      })
    return () => { alive = false }
  }, [active, reload])

  async function fileDraft() {
    const draft = chat.ticketDraft
    if (!draft?.ready || filing) return
    setFiling(true)
    try {
      const data = await supportTicketRequest('/api/admin-drivers?action=ticket', {
        method: 'POST',
        body: JSON.stringify({
          confirmed: true,
          category: draft.category,
          subject: draft.subject,
          body: draft.body,
          roleVariant: chat.roleVariant,
        }),
      })
      const id = data.ticket?.id
      chat.setTicketDraft(null)
      chat.setMessages((current) => [...current, {
        id: `filed-${id || Date.now()}`,
        role: 'assistant',
        content: id
          ? `Ticket ${id} is open. A person can read it in the support_tickets table. You can also email rides@clemson.edu and mention that id.`
          : 'The ticket was filed.',
      }])
      setReload((value) => value + 1)
    } catch (error) {
      chat.setMessages((current) => [...current, {
        id: `file-err-${Date.now()}`,
        role: 'assistant',
        content: `${error.message || 'Could not file the ticket.'} You can email rides@clemson.edu with the same details.`,
      }])
    } finally {
      setFiling(false)
    }
  }

  return (
    <ChatShell
      kicker="SUPPORT"
      title={chat.roleVariant === 'driver' ? 'Driver Support' : 'Rider Support'}
      subtitle="Issues, bugs, and tickets. Separate from Help."
    >
      {chat.showRoleToggle && (
        <Segment
          label="Support role"
          value={chat.roleVariant}
          onChange={chat.switchRole}
          options={[{ id: 'rider', label: 'Rider' }, { id: 'driver', label: 'Driver' }]}
        />
      )}
      <Segment
        label="Support input mode"
        value={chat.mode}
        onChange={chat.chooseMode}
        options={[{ id: 'text', label: 'Text' }, { id: 'voice', label: 'Voice' }]}
      />
      <SpeechBanner text={chat.speechNote} />
      {chat.contextSummary && (
        <div style={{ fontSize: 12, color: '#522D80', marginBottom: 8 }}>{chat.contextSummary}</div>
      )}
      {chat.notice && (
        <div style={{ fontSize: 12, color: 'var(--ink-secondary)', marginBottom: 8, lineHeight: 1.4 }}>{chat.notice}</div>
      )}
      {chat.messages.length < 3 && (
        <ChipRow chips={chips} disabled={chat.busy} onPick={chat.send} />
      )}
      <MessageList messages={chat.messages} onAction={openAction} />
      {chat.ticketDraft?.ready && (
        <div style={{
          marginBottom: 10,
          padding: 12,
          borderRadius: 14,
          background: 'rgba(245,102,0,0.08)',
          border: '1px solid rgba(245,102,0,0.35)',
        }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#522D80' }}>
            Confirm ticket · {categoryLabel(chat.ticketDraft.category)}
          </div>
          <div style={{ fontWeight: 700, marginTop: 4 }}>{chat.ticketDraft.subject}</div>
          <div style={{ fontSize: 12, whiteSpace: 'pre-wrap', color: 'var(--ink-secondary)', marginTop: 6 }}>
            {chat.ticketDraft.body}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button
              type="button"
              className="pressable"
              disabled={filing}
              onClick={fileDraft}
              style={{
                padding: '8px 12px',
                borderRadius: 12,
                fontWeight: 800,
                color: '#fff',
                background: '#F56600',
              }}
            >
              {filing ? 'Filing…' : 'Confirm and file'}
            </button>
            <button
              type="button"
              className="pressable"
              onClick={() => chat.setTicketDraft(null)}
              style={{ padding: '8px 12px', borderRadius: 12, fontWeight: 700, color: '#522D80' }}
            >
              Not yet
            </button>
          </div>
          <a href={mailtoFor(chat.ticketDraft)} style={{ display: 'inline-block', marginTop: 8, fontSize: 12, color: '#522D80' }}>
            Email this instead
          </a>
        </div>
      )}
      <Composer
        value={chat.draft}
        onChange={chat.setDraft}
        busy={chat.busy}
        mode={chat.mode}
        listening={chat.listening}
        placeholder="Describe the billing issue, bug, or ride problem"
        onMic={chat.startMic}
        onSubmit={(event) => {
          event.preventDefault()
          chat.send(chat.draft)
        }}
      />
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: '#522D80' }}>
          {isAdmin ? 'All tickets' : 'Your tickets'}
        </div>
        {listNote && <div style={{ fontSize: 12, color: 'var(--ink-secondary)', marginTop: 4 }}>{listNote}</div>}
        {tickets.length === 0 && !listNote && (
          <div style={{ fontSize: 12, color: 'var(--ink-tertiary)', marginTop: 4 }}>No tickets yet.</div>
        )}
        {tickets.map((ticket) => (
          <div key={ticket.id} style={{ fontSize: 12, marginTop: 6, color: 'var(--ink-secondary)' }}>
            <strong style={{ color: '#522D80' }}>{ticket.status}</strong>
            {' · '}
            {categoryLabel(ticket.category)}
            {' · '}
            {ticket.subject}
          </div>
        ))}
      </div>
    </ChatShell>
  )
}
