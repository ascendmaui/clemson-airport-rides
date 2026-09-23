import { HELP_CHIPS } from '../../server/agentChips.js'
import {
  ChatShell, ChipRow, Composer, MessageList, Segment, SpeechBanner, openAction,
} from './chatChrome'
import { useAssistChat } from '../lib/useAssistChat'

function welcome(role) {
  if (role === 'driver') {
    return 'Driver Help walks you through going online, signup, the heat map, carpool, and earnings. I do not file tickets. For a fare problem or a rider dispute, open Support.'
  }
  return 'Rider Help walks you through booking, Schedule, friends, student discount, and billing. I do not file tickets. For a bad charge or a bug, open Support.'
}

export function HelpChatPanel({ accountRole = null, active = true }) {
  const chat = useAssistChat({
    scope: 'help',
    endpoint: '/api/help-chat',
    accountRole,
    welcome,
    active,
  })
  const chips = HELP_CHIPS[chat.roleVariant] || HELP_CHIPS.rider

  return (
    <ChatShell
      kicker="HELP"
      title={chat.roleVariant === 'driver' ? 'Driver Help' : 'Rider Help'}
      subtitle="How Clemson RIDES works. This chat does not file tickets."
    >
      {chat.showRoleToggle && (
        <Segment
          label="Help role"
          value={chat.roleVariant}
          onChange={chat.switchRole}
          options={[{ id: 'rider', label: 'Rider' }, { id: 'driver', label: 'Driver' }]}
        />
      )}
      <Segment
        label="Help input mode"
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
      <Composer
        value={chat.draft}
        onChange={chat.setDraft}
        busy={chat.busy}
        mode={chat.mode}
        listening={chat.listening}
        placeholder={chat.roleVariant === 'driver' ? 'Ask how to go online, signup, or read the map' : 'Ask how to book, split a fare, or add a card'}
        onMic={chat.startMic}
        onSubmit={(event) => {
          event.preventDefault()
          chat.send(chat.draft)
        }}
      />
    </ChatShell>
  )
}
