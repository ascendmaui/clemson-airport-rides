-- Unsigned pre-filled contractor packets, admin send audit, and signing links.
-- Submitting an application no longer requires a signature.
-- Approving still requires the current version, and the signed hash must match
-- the stored packet when one exists.

alter table public.driver_tax_info
  add column if not exists address_line text,
  add column if not exists business_name text;

alter table public.driver_agreements
  add column if not exists signed_ip text,
  add column if not exists signed_user_agent text,
  add column if not exists signature_accepted boolean not null default false;

create table if not exists public.driver_agreement_packets (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  agreement_version text not null references public.driver_agreement_versions (version),
  prefill jsonb not null,
  html_snapshot text not null,
  html_sha256 text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint driver_agreement_packets_profile_version_key unique (profile_id, agreement_version)
);

create table if not exists public.driver_agreement_sign_links (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  agreement_version text not null,
  packet_sha256 text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid
);

create table if not exists public.driver_agreement_sends (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  admin_id uuid,
  to_address text,
  result text not null,
  agreement_version text,
  packet_sha256 text,
  link_id uuid,
  created_at timestamptz not null default now(),
  constraint driver_agreement_sends_result_check check (result in ('emailed', 'not_configured', 'failed'))
);

alter table public.driver_agreement_packets enable row level security;
alter table public.driver_agreement_sign_links enable row level security;
alter table public.driver_agreement_sends enable row level security;

revoke all on table public.driver_agreement_packets from public, anon;
revoke all on table public.driver_agreement_sign_links from public, anon, authenticated;
revoke all on table public.driver_agreement_sends from public, anon;
grant select on table public.driver_agreement_packets to authenticated;
grant all on table public.driver_agreement_packets to service_role;
grant all on table public.driver_agreement_sign_links to service_role;
grant select on table public.driver_agreement_sends to authenticated;
grant all on table public.driver_agreement_sends to service_role;

drop policy if exists driver_agreement_packets_select on public.driver_agreement_packets;
create policy driver_agreement_packets_select
  on public.driver_agreement_packets
  for select
  to authenticated
  using (auth.uid() = profile_id or public.is_admin());

drop policy if exists driver_agreement_sends_admin_select on public.driver_agreement_sends;
create policy driver_agreement_sends_admin_select
  on public.driver_agreement_sends
  for select
  to authenticated
  using (public.is_admin());

create or replace function public.set_driver_mailing_address(
  address_line text,
  business_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned_address text := nullif(trim(coalesce(address_line, '')), '');
  cleaned_business text := nullif(trim(coalesce(business_name, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  update public.driver_tax_info
  set address_line = cleaned_address,
      business_name = coalesce(cleaned_business, driver_tax_info.business_name),
      updated_at = now()
  where profile_id = auth.uid();
  if not found then
    raise exception 'Save W-9 before adding an address';
  end if;
  return jsonb_build_object(
    'address_line', cleaned_address,
    'business_name', cleaned_business
  );
end;
$$;

revoke all on function public.set_driver_mailing_address(text, text) from public;
grant execute on function public.set_driver_mailing_address(text, text) to authenticated;

create or replace function public.driver_submission_ready(target uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  missing integer;
  app public.driver_applications;
begin
  select count(*) into missing
  from public.driver_required_documents req
  where req.doc_type not in ('background_authorization', 'work_eligibility', 'w9')
    and not exists (
    select 1
    from public.driver_documents d
    where d.profile_id = target
      and d.doc_type = req.doc_type
  );
  if coalesce(missing, 0) > 0 then
    return false;
  end if;

  select * into app
  from public.driver_applications
  where profile_id = target;

  if app.id is null
     or app.background_authorized_at is null
     or app.work_eligibility_attested_at is null
     or app.work_eligibility_category is null then
    return false;
  end if;

  if not exists (
    select 1
    from public.driver_tax_info t
    where t.profile_id = target
      and length(trim(t.legal_name)) >= 2
      and t.tin_last4 ~ '^[0-9]{4}$'
  ) then
    return false;
  end if;

  return true;
end;
$$;

revoke all on function public.driver_submission_ready(uuid) from public;
grant execute on function public.driver_submission_ready(uuid) to authenticated, service_role;

create or replace function public.driver_approval_ready(target uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  packet_hash text;
  signed_hash text;
begin
  if not public.driver_submission_ready(target) then
    return false;
  end if;

  select a.agreement_sha256 into signed_hash
  from public.driver_agreements a
  where a.profile_id = target
    and a.signer_user_id = target
    and a.agreement_version = 'ic-agreement-2026-10-05'
    and length(trim(a.signature_name)) >= 2
    and a.signed_at is not null;

  if signed_hash is null then
    return false;
  end if;

  select p.html_sha256 into packet_hash
  from public.driver_agreement_packets p
  where p.profile_id = target
    and p.agreement_version = 'ic-agreement-2026-10-05';

  if packet_hash is not null and packet_hash is distinct from signed_hash then
    return false;
  end if;

  return true;
end;
$$;

revoke all on function public.driver_approval_ready(uuid) from public;
grant execute on function public.driver_approval_ready(uuid) to authenticated, service_role;

create or replace function public.guard_driver_application()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed boolean := false;
begin
  if new.onboarding_status is null then
    new.onboarding_status := 'pending_info';
  end if;

  new.status := case new.onboarding_status
    when 'approved' then 'approved'
    when 'rejected' then 'rejected'
    else 'pending'
  end;

  if public.is_service_role() or public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.profile_id is distinct from auth.uid() then
      raise exception 'Cannot create an application for another driver';
    end if;
    if new.onboarding_status not in ('pending_info', 'pending_docs') then
      raise exception 'New applications cannot be auto-approved';
    end if;
    new.reviewed_at := null;
    new.reviewed_by := null;
    new.rejection_reason := null;
    return new;
  end if;

  if new.profile_id is distinct from old.profile_id then
    raise exception 'Cannot reassign an application';
  end if;

  if new.onboarding_status is not distinct from old.onboarding_status then
    new.reviewed_at := old.reviewed_at;
    new.reviewed_by := old.reviewed_by;
    new.admin_notified_at := old.admin_notified_at;
    if old.onboarding_status is distinct from 'rejected' then
      new.rejection_reason := old.rejection_reason;
    end if;
    return new;
  end if;

  allowed := (
    (old.onboarding_status in ('pending_info', 'rejected') and new.onboarding_status = 'pending_docs')
    or (old.onboarding_status = 'pending_docs' and new.onboarding_status in ('pending_docs', 'pending_review'))
    or (old.onboarding_status = 'pending_review' and new.onboarding_status = 'pending_docs')
    or (old.onboarding_status = 'rejected' and new.onboarding_status = 'pending_review')
  );

  if not allowed then
    raise exception 'Drivers cannot set onboarding status to %', new.onboarding_status;
  end if;

  if new.onboarding_status = 'pending_review' then
    if not public.driver_submission_ready(new.profile_id) then
      raise exception 'Upload all required documents and tax info before submitting for review';
    end if;
    new.submitted_at := now();
  end if;

  new.reviewed_at := old.reviewed_at;
  new.reviewed_by := old.reviewed_by;
  if new.onboarding_status is distinct from 'rejected' then
    new.rejection_reason := null;
  else
    new.rejection_reason := old.rejection_reason;
  end if;
  return new;
end;
$$;

create or replace function public.review_driver_application(
  target_profile uuid,
  decision text,
  reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  app public.driver_applications;
  target_role public.user_role;
begin
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;
  if decision not in ('approve', 'reject') then
    raise exception 'Decision must be approve or reject';
  end if;
  if decision = 'reject' and length(trim(coalesce(reason, ''))) < 3 then
    raise exception 'A rejection reason is required';
  end if;

  select * into app
  from public.driver_applications
  where profile_id = target_profile;

  if app.id is null then
    raise exception 'Application not found';
  end if;

  if decision = 'approve'
     and app.onboarding_status is distinct from 'approved'
     and not public.driver_approval_ready(target_profile) then
    raise exception 'Application is missing required documents, tax info, or a signed agreement';
  end if;

  update public.driver_applications
  set
    onboarding_status = case when decision = 'approve' then 'approved' else 'rejected' end,
    reviewed_at = now(),
    reviewed_by = auth.uid(),
    rejection_reason = case when decision = 'reject' then trim(reason) else null end
  where profile_id = target_profile
  returning * into app;

  select role into target_role from public.profiles where id = target_profile;

  if decision = 'approve' then
    if target_role is distinct from 'admin' and target_role is distinct from 'ops' then
      update public.profiles
      set role = 'driver', updated_at = now()
      where id = target_profile;
    end if;
  else
    if target_role = 'driver' then
      update public.profiles
      set role = 'rider', updated_at = now()
      where id = target_profile;
    end if;
    insert into public.driver_status (driver_id, online, updated_at)
    values (target_profile, false, now())
    on conflict (driver_id) do update
      set online = false, updated_at = now();
  end if;

  return to_jsonb(app);
end;
$$;

revoke all on function public.review_driver_application(uuid, text, text) from public;
grant execute on function public.review_driver_application(uuid, text, text) to authenticated;
