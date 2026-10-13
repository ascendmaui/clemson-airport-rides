-- Inbound Hostinger Agentic Mail events for agents@clemsonrides.com.
-- Additive. The webhook stores a row and never sends mail.
--
-- Down (reversible):
--   drop table if exists public.inbound_agent_mail;

create table if not exists public.inbound_agent_mail (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  message_id text not null,
  "from" text,
  "to" text,
  subject text,
  snippet text,
  raw jsonb not null,
  status text not null default 'new',
  constraint inbound_agent_mail_message_id_key unique (message_id)
);

comment on table public.inbound_agent_mail is
  'Hostinger Agentic Mail webhook events. Service role only. The receiver does not send or reply to email.';

create index if not exists inbound_agent_mail_received_idx
  on public.inbound_agent_mail (received_at desc);

create index if not exists inbound_agent_mail_new_idx
  on public.inbound_agent_mail (received_at desc)
  where status = 'new';

alter table public.inbound_agent_mail enable row level security;

revoke all on table public.inbound_agent_mail from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.inbound_agent_mail from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.inbound_agent_mail from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on table public.inbound_agent_mail to service_role;
  end if;
end
$$;
