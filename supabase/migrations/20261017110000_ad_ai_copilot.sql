-- AI co-pilot usage log for per-partner and global daily caps. Additive and idempotent.
-- Writes come from /api/ads with the service role; admins can read.
create table if not exists public.ad_ai_usage (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid references public.ad_partners(id) on delete set null,
  kind text not null check (kind in ('suggest', 'image', 'video')),
  provider text,
  cost_cents integer not null default 0 check (cost_cents >= 0),
  created_at timestamptz not null default now()
);
create index if not exists ad_ai_usage_created_idx on public.ad_ai_usage (created_at desc);
create index if not exists ad_ai_usage_partner_idx on public.ad_ai_usage (partner_id, created_at desc);
alter table public.ad_ai_usage enable row level security;
drop policy if exists ad_ai_usage_admin_read on public.ad_ai_usage;
create policy ad_ai_usage_admin_read on public.ad_ai_usage for select to authenticated using (public.is_admin());
