-- Background attestation status for driver applications.
-- pending: the attestation is unfinished (a consent checkbox alone stays here).
-- authorized: the applicant consented and disclosed nothing that needs a look.
-- needs_review: the applicant consented and answered yes to a disclosure.
-- None of these values is a completed vendor background check.

do $$
begin
  if to_regclass('public.driver_applications') is null then
    return;
  end if;

  execute 'alter table public.driver_applications add column if not exists background_check_status text';
  execute 'alter table public.driver_applications add column if not exists background_legal_name text';
  execute 'alter table public.driver_applications add column if not exists background_signature_name text';
  execute 'alter table public.driver_applications add column if not exists background_signed_on date';
  execute 'alter table public.driver_applications add column if not exists background_consent_version text';
  execute 'alter table public.driver_applications add column if not exists background_disclosures jsonb';
  execute 'alter table public.driver_applications add column if not exists background_admin_reviewed_at timestamptz';

  execute $cmt$
    comment on column public.driver_applications.background_check_status is
      'Attestation only: pending, authorized, or needs_review. Authorized is consent on file, not a vendor clear.'
  $cmt$;
end $$;

do $$
begin
  if to_regclass('public.driver_applications') is null then
    return;
  end if;
  if exists (
    select 1 from pg_constraint
    where conname = 'driver_applications_background_status_check'
      and conrelid = 'public.driver_applications'::regclass
  ) then
    alter table public.driver_applications drop constraint driver_applications_background_status_check;
  end if;
  alter table public.driver_applications
    add constraint driver_applications_background_status_check
    check (
      background_check_status is null
      or background_check_status in ('pending', 'authorized', 'needs_review')
    );
end $$;

create or replace function public.enforce_background_attestation()
returns trigger
language plpgsql
as $$
declare
  answers jsonb := coalesce(new.background_disclosures, '{}'::jsonb);
  keys text[] := array['conviction', 'license_action', 'impaired_driving'];
  key text;
  raw text;
  answered boolean := true;
  flagged boolean := false;
  signed boolean := false;
  privileged boolean := false;
begin
  if new.background_check_status is not null
     and new.background_check_status not in ('pending', 'authorized', 'needs_review') then
    raise exception 'Background status must be pending, authorized, or needs review. A vendor result is not stored here.';
  end if;

  if to_regprocedure('public.is_service_role()') is not null then
    execute 'select public.is_service_role()' into privileged;
  end if;
  if not privileged and to_regprocedure('public.is_admin()') is not null then
    execute 'select public.is_admin()' into privileged;
  end if;

  if tg_op = 'UPDATE' and not privileged then
    new.background_admin_reviewed_at := old.background_admin_reviewed_at;
  elsif tg_op = 'INSERT' and not privileged then
    new.background_admin_reviewed_at := null;
  end if;

  if new.background_disclosures is null then
    if new.background_check_status in ('authorized', 'needs_review') then
      new.background_check_status := 'pending';
    end if;
    return new;
  end if;

  foreach key in array keys loop
    raw := answers ->> key;
    if raw is null or raw not in ('true', 'false') then
      answered := false;
    elsif raw = 'true' then
      flagged := true;
    end if;
  end loop;

  signed := new.background_authorized_at is not null
    and length(trim(coalesce(new.background_signature_name, ''))) >= 2
    and new.background_signed_on is not null
    and length(trim(coalesce(new.background_legal_name, ''))) >= 2;

  if not answered or not signed then
    new.background_check_status := 'pending';
  elsif flagged then
    new.background_check_status := 'needs_review';
  else
    new.background_check_status := 'authorized';
  end if;

  return new;
end;
$$;

do $$
begin
  if to_regclass('public.driver_applications') is null then
    return;
  end if;
  execute 'drop trigger if exists driver_applications_background_attestation on public.driver_applications';
  execute $t$
    create trigger driver_applications_background_attestation
      before insert or update on public.driver_applications
      for each row
      execute function public.enforce_background_attestation()
  $t$;
end $$;

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
  background_status text;
  background_reviewed timestamptz;
begin
  if not public.driver_submission_ready(target) then
    return false;
  end if;

  select a.background_check_status, a.background_admin_reviewed_at
    into background_status, background_reviewed
  from public.driver_applications a
  where a.profile_id = target;

  if background_status is distinct from 'authorized'
     and not (background_status = 'needs_review' and background_reviewed is not null) then
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
