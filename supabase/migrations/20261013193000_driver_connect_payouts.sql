-- Driver Connect payout history. Additive. The daily 8 AM (12:00 UTC)
-- driver-payouts cron is unchanged. Full bank account numbers are not stored.
-- Status chips are updated from Stripe payout webhooks.

alter table public.profiles add column if not exists stripe_details_submitted boolean;
alter table public.profiles add column if not exists stripe_payouts_enabled boolean;

create table if not exists public.driver_payout_events (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null,
  stripe_account_id text,
  stripe_event_id text,
  event_type text not null,
  stripe_payout_id text,
  amount_cents integer,
  currency text,
  status text not null default 'pending',
  method text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint driver_payout_events_status_check check (status in ('pending', 'in_transit', 'paid', 'failed')),
  constraint driver_payout_events_method_check check (method is null or method in ('instant', 'standard'))
);

create unique index if not exists driver_payout_events_payout_uidx
  on public.driver_payout_events (stripe_payout_id)
  where stripe_payout_id is not null;

create unique index if not exists driver_payout_events_event_uidx
  on public.driver_payout_events (stripe_event_id)
  where stripe_event_id is not null;

create index if not exists driver_payout_events_driver_idx
  on public.driver_payout_events (driver_id, created_at desc);

alter table public.driver_payout_events enable row level security;

drop policy if exists driver_payout_events_owner_select on public.driver_payout_events;
create policy driver_payout_events_owner_select
  on public.driver_payout_events
  for select
  to authenticated
  using (driver_id = auth.uid() or public.is_admin());

revoke all on table public.driver_payout_events from public, anon, authenticated;
grant select (
  id,
  driver_id,
  stripe_account_id,
  stripe_event_id,
  event_type,
  stripe_payout_id,
  amount_cents,
  currency,
  status,
  method,
  created_at,
  updated_at
) on table public.driver_payout_events to authenticated;
grant all on table public.driver_payout_events to service_role;

create or replace function public.touch_driver_payout_events()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' and new.created_at is null then
    new.created_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists driver_payout_events_touch on public.driver_payout_events;
create trigger driver_payout_events_touch
  before insert or update on public.driver_payout_events
  for each row execute function public.touch_driver_payout_events();
