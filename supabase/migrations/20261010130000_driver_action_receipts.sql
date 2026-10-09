-- Driver flow slice 2: idempotency receipts for driver trip actions.
--
-- The driver app queues status taps made while offline and retries them in
-- order with an idempotency key. The API claims the key here before running
-- the action (http_status 0 = in flight, so a concurrent retry waits), then
-- stores the 2xx response and replays it for any retry. A failed attempt
-- releases its claim so the same key can be retried.
-- Service role only: RLS on, no policies, no client grants.
--
-- Down (reversible):
--   drop table if exists public.driver_action_receipts;

create table if not exists public.driver_action_receipts (
  idempotency_key text primary key,
  driver_id uuid not null,
  trip_id uuid not null references public.trips(id) on delete cascade,
  op text not null,
  http_status integer not null default 0,
  response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint driver_action_receipts_key_shape check (idempotency_key ~ '^[A-Za-z0-9:_.-]{8,128}$')
);

create index if not exists driver_action_receipts_trip_idx on public.driver_action_receipts (trip_id);
create index if not exists driver_action_receipts_created_idx on public.driver_action_receipts (created_at);

alter table public.driver_action_receipts enable row level security;
revoke all on public.driver_action_receipts from public, anon, authenticated;
grant all on public.driver_action_receipts to service_role;
