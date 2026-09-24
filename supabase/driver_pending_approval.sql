-- Pending-approval gates, document review flags, and in-app form signatures.
-- Additive. Does not delete driver rows. Apply after driver_onboarding_compliance.sql
-- so the ic-agreement-2026-09-24 version exists before drivers sign it.

alter table public.driver_documents
  add column if not exists review_status text,
  add column if not exists review_note text,
  add column if not exists match_status text;

alter table public.driver_applications
  add column if not exists background_signature_name text,
  add column if not exists background_signed_on date,
  add column if not exists background_consent_version text,
  add column if not exists background_check_status text,
  add column if not exists work_eligibility_signature_name text,
  add column if not exists work_eligibility_signed_on date,
  add column if not exists work_eligibility_consent_version text;

alter table public.driver_tax_info
  add column if not exists business_name text,
  add column if not exists address_line text,
  add column if not exists w9_signature_name text,
  add column if not exists w9_signed_on date,
  add column if not exists w9_version text;

create table if not exists public.driver_form_signatures (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  form_id text not null,
  form_version text not null,
  signature_name text not null,
  signed_on date not null,
  signature_mark jsonb,
  signed_at timestamptz not null default now(),
  unique (profile_id, form_id, form_version)
);

alter table public.driver_form_signatures enable row level security;

drop policy if exists driver_form_signatures_owner on public.driver_form_signatures;
create policy driver_form_signatures_owner
  on public.driver_form_signatures
  for all
  to authenticated
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

drop policy if exists driver_form_signatures_admin on public.driver_form_signatures;
create policy driver_form_signatures_admin
  on public.driver_form_signatures
  for select
  to authenticated
  using (public.is_admin());

grant select, insert, update on table public.driver_form_signatures to authenticated;

create table if not exists public.driver_profile_photos (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  storage_path text not null,
  review_status text not null default 'pending_manual_review',
  created_at timestamptz not null default now()
);

alter table public.driver_profile_photos enable row level security;

drop policy if exists driver_profile_photos_owner on public.driver_profile_photos;
create policy driver_profile_photos_owner
  on public.driver_profile_photos
  for all
  to authenticated
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

drop policy if exists driver_profile_photos_admin on public.driver_profile_photos;
create policy driver_profile_photos_admin
  on public.driver_profile_photos
  for select
  to authenticated
  using (public.is_admin());

grant select, insert on table public.driver_profile_photos to authenticated;

create or replace function public.save_driver_w9(
  legal_name text,
  tin text,
  tax_classification text,
  business_name text,
  address_line text,
  signature_name text,
  signed_on date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  saved jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  if length(trim(coalesce(signature_name, ''))) < 2 then
    raise exception 'Type your legal name to sign';
  end if;
  saved := public.save_driver_tax_info(legal_name, tin, tax_classification);
  update public.driver_tax_info
    set business_name = nullif(trim(coalesce(save_driver_w9.business_name, '')), ''),
        address_line = nullif(trim(coalesce(save_driver_w9.address_line, '')), ''),
        w9_signature_name = trim(save_driver_w9.signature_name),
        w9_signed_on = save_driver_w9.signed_on,
        w9_version = 'w9-2026-09-24',
        updated_at = now()
    where profile_id = auth.uid();
  return saved;
end;
$$;

revoke all on function public.save_driver_w9(text, text, text, text, text, text, date) from public;
grant execute on function public.save_driver_w9(text, text, text, text, text, text, date) to authenticated;

create or replace function public.enforce_driver_online_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.online = true and not public.driver_is_approved(new.driver_id) then
    raise exception 'Finish approval to go online. Your account is still under review.';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_trip_approved_driver()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  assigning boolean := false;
begin
  if new.driver_id is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    assigning := new.status is distinct from 'canceled';
  else
    assigning := new.driver_id is distinct from old.driver_id
      or (old.status in ('searching', 'offered') and new.status = 'accepted');
  end if;

  if assigning and not public.driver_is_approved(new.driver_id) then
    raise exception 'Finish approval to go online. Your account is still under review.';
  end if;
  return new;
end;
$$;
