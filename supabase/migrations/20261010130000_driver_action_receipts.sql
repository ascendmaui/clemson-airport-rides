-- Driver flow slice 2: idempotency receipts for driver trip actions.
--
-- The driver app queues status taps made while offline and retries them in
-- order with an Idempotency-Key. The API records the first successful
-- response per key here and replays it for any retry, so a tap that reached
-- the server before the signal dropped is never applied twice.
-- Service role only: RLS on, no policies, no client grants.
--
-- Down (reversible):
--   drop table if exists public.driver_action_receipts;

create table if not exists public.driver_action_receipts (
  idempotency_key text primary key,
  driver_id uuid not null,
  trip_id uuid not null references public.trips(id) on delete cascade,
  op text not null,
  http_status integer not null,
  response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint driver_action_receipts_key_shape check (idempotency_key ~ '^[A-Za-z0-9:_.-]{8,128}$')
);

create index if not exists driver_action_receipts_trip_idx on public.driver_action_receipts (trip_id);
create index if not exists driver_action_receipts_created_idx on public.driver_action_receipts (created_at);

alter table public.driver_action_receipts enable row level security;
revoke all on public.driver_action_receipts from public, anon, authenticated;
grant all on public.driver_action_receipts to service_role;
