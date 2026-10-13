-- Drafts and summaries for inbound Clemson mailboxes.
-- Additive. draft_reply is text for John to approve. The server never sends it.
-- agents@ stores a summary and does not get a draft.
-- noreply@ is not written by the receiver.

alter table public.inbound_agent_mail
  add column if not exists mailbox text,
  add column if not exists role text,
  add column if not exists draft_reply text,
  add column if not exists summary text;

comment on column public.inbound_agent_mail.draft_reply is
  'Reply draft for John to approve. The inbound receiver never sends this text.';

comment on column public.inbound_agent_mail.summary is
  'Short summary for agents@ alerts. Not a reply.';

alter table public.inbound_agent_mail
  drop constraint if exists inbound_agent_mail_status_check;

alter table public.inbound_agent_mail
  add constraint inbound_agent_mail_status_check
  check (status in ('new', 'draft_ready', 'summarized'));

create index if not exists inbound_agent_mail_draft_ready_idx
  on public.inbound_agent_mail (received_at desc)
  where status = 'draft_ready';
