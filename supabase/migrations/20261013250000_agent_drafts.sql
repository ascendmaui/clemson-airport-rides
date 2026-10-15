-- Drafts from the marketing, affiliate, and outreach agents.
-- Additive. John approves each row. The server never sends these drafts.
--
-- Down (reversible):
--   drop table if exists public.agent_drafts;

create table if not exists public.agent_drafts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null,
  status text not null default 'draft_ready',
  subject text,
  body text not null,
  source text not null,
  mailbox text,
  message_id text,
  slot text not null,
  context jsonb not null default '{}'::jsonb,
  constraint agent_drafts_kind_check check (kind in ('marketing', 'affiliate', 'outreach')),
  constraint agent_drafts_status_check check (status in ('draft_ready')),
  constraint agent_drafts_source_check check (source in ('mail', 'schedule'))
);

comment on table public.agent_drafts is
  'Drafts for John to approve. Service role only. Agents do not send email or post to social networks.';

create index if not exists agent_drafts_created_idx
  on public.agent_drafts (created_at desc);

create unique index if not exists agent_drafts_mail_slot_key
  on public.agent_drafts (kind, message_id, slot)
  where message_id is not null;

alter table public.agent_drafts enable row level security;

revoke all on table public.agent_drafts from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.agent_drafts from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.agent_drafts from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on table public.agent_drafts to service_role;
  end if;
end
$$;
