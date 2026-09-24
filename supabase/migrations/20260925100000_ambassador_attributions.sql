-- Which signed-in rider opened /a/:code. Not a payout.
-- ambassador_payout_ledger is still written only when a carpool completes.

create table if not exists public.ambassador_attributions (
  user_id uuid primary key,
  code text not null,
  code_type text not null default 'ambassador',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ambassador_attributions_code_type_check check (code_type = 'ambassador')
);

alter table public.ambassador_attributions enable row level security;
