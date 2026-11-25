-- OPS_APPLY: do not apply this from CI or an app deploy.
-- Expo push tickets for the receipt sweep. Sends work without this table.
-- The sweep in server/expoPushReceipts.js no-ops until the table exists.
-- After it is applied, DeviceNotRegistered receipts delete that stored token.

create table if not exists public.expo_push_tickets (
  ticket_id text primary key,
  token text not null,
  owner_id uuid,
  owner_role text check (owner_role in ('rider', 'driver')),
  created_at timestamptz not null default now(),
  checked_at timestamptz,
  receipt_status text,
  receipt_error text
);

create index if not exists expo_push_tickets_unchecked_idx
  on public.expo_push_tickets (created_at)
  where checked_at is null;

alter table public.expo_push_tickets enable row level security;
revoke all on public.expo_push_tickets from public, anon, authenticated;
grant all on public.expo_push_tickets to service_role;
