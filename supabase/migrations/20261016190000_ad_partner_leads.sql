-- /advertise interest form leads. Additive only.
-- RLS: anonymous (and signed-in) visitors may insert; only admins may read, edit or delete.
create table if not exists public.ad_partner_leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  business_name text not null check (char_length(business_name) between 2 and 120),
  contact_name text not null check (char_length(contact_name) between 2 and 120),
  email text not null check (char_length(email) between 3 and 254 and email like '%@%'),
  phone text not null check (char_length(phone) between 7 and 32),
  category text not null check (char_length(category) between 1 and 80),
  interested_tier text check (interested_tier is null or char_length(interested_tier) <= 80),
  message text check (message is null or char_length(message) <= 2000),
  source text not null default 'advertise_page' check (char_length(source) <= 40),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  status text not null default 'new' check (status in ('new', 'contacted', 'won', 'lost', 'spam'))
);

create index if not exists ad_partner_leads_created_idx on public.ad_partner_leads (created_at desc);

alter table public.ad_partner_leads enable row level security;

revoke all on public.ad_partner_leads from anon, authenticated;
grant insert (business_name, contact_name, email, phone, category, interested_tier, message, source, user_agent)
  on public.ad_partner_leads to anon, authenticated;
grant select, update, delete on public.ad_partner_leads to authenticated;
grant all on public.ad_partner_leads to service_role;

drop policy if exists ad_partner_leads_public_insert on public.ad_partner_leads;
create policy ad_partner_leads_public_insert on public.ad_partner_leads
  for insert to anon, authenticated
  with check (status = 'new' and source = 'advertise_page');

drop policy if exists ad_partner_leads_admin_select on public.ad_partner_leads;
create policy ad_partner_leads_admin_select on public.ad_partner_leads
  for select to authenticated using (public.is_admin());

drop policy if exists ad_partner_leads_admin_update on public.ad_partner_leads;
create policy ad_partner_leads_admin_update on public.ad_partner_leads
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists ad_partner_leads_admin_delete on public.ad_partner_leads;
create policy ad_partner_leads_admin_delete on public.ad_partner_leads
  for delete to authenticated using (public.is_admin());

comment on table public.ad_partner_leads is 'Advertise-with-us interest form leads (/advertise). Anonymous insert, admin-only read.';
