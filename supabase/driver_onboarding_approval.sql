-- Driver onboarding approval gate.
-- Additive only: new columns, driver_documents, private storage bucket, RLS, triggers.
-- Existing role=driver profiles are grandfathered as approved so live drivers keep working.
-- New applications cannot set themselves to approved.

alter table public.profiles
  add column if not exists is_admin boolean not null default false;

alter table public.driver_applications
  add column if not exists onboarding_status text,
  add column if not exists rejection_reason text,
  add column if not exists review_note text,
  add column if not exists reviewed_by uuid references public.profiles(id),
  add column if not exists submitted_at timestamptz,
  add column if not exists admin_notified_at timestamptz,
  add column if not exists notify_error text;

update public.driver_applications
set onboarding_status = case status
  when 'approved' then 'approved'
  when 'rejected' then 'rejected'
  else 'pending_info'
end
where onboarding_status is null;

alter table public.driver_applications
  alter column onboarding_status set default 'pending_info';

update public.driver_applications
set onboarding_status = 'pending_info'
where onboarding_status is null;

alter table public.driver_applications
  alter column onboarding_status set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'driver_applications_onboarding_status_check'
  ) then
    alter table public.driver_applications
      add constraint driver_applications_onboarding_status_check
      check (onboarding_status in (
        'pending_info', 'pending_docs', 'pending_review', 'approved', 'rejected'
      ));
  end if;
end $$;

create table if not exists public.driver_documents (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  doc_type text not null,
  storage_path text not null,
  created_at timestamptz not null default now(),
  constraint driver_documents_doc_type_check check (doc_type in (
    'license_front', 'license_back',
    'insurance_front', 'insurance_back',
    'registration',
    'car_front', 'car_back', 'car_left', 'car_right'
  )),
  constraint driver_documents_profile_doc_key unique (profile_id, doc_type)
);

create index if not exists driver_applications_onboarding_status_idx
  on public.driver_applications (onboarding_status);

create index if not exists driver_documents_profile_idx
  on public.driver_documents (profile_id);

grant select, insert, update, delete on public.driver_documents to anon, authenticated, service_role;

create or replace function public.is_service_role()
returns boolean
language sql
stable
as $$
  select coalesce(auth.role(), '') = 'service_role'
    or coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role';
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    lower(coalesce(auth.jwt() ->> 'email', '')) = 'john@gmail.com'
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and (p.is_admin = true or p.role in ('admin', 'ops'))
    );
$$;

create or replace function public.driver_is_approved(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.driver_applications
    where profile_id = uid
      and onboarding_status = 'approved'
  );
$$;

create or replace function public.list_approved_driver_ids(ids uuid[])
returns table (profile_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select da.profile_id
  from public.driver_applications da
  where da.onboarding_status = 'approved'
    and (ids is null or da.profile_id = any(ids));
$$;

revoke all on function public.is_service_role() from public;
revoke all on function public.is_admin() from public;
revoke all on function public.driver_is_approved(uuid) from public;
revoke all on function public.list_approved_driver_ids(uuid[]) from public;
grant execute on function public.is_service_role() to anon, authenticated, service_role;
grant execute on function public.is_admin() to anon, authenticated, service_role;
grant execute on function public.driver_is_approved(uuid) to anon, authenticated, service_role;
grant execute on function public.list_approved_driver_ids(uuid[]) to anon, authenticated, service_role;

create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  jwt_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  privileged boolean := public.is_service_role() or public.is_admin() or jwt_email = 'john@gmail.com';
begin
  if jwt_email = 'john@gmail.com' then
    new.is_admin := true;
    new.role := 'admin';
    return new;
  end if;

  if privileged then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.is_admin := false;
    if new.role in ('admin', 'ops') then
      new.role := 'rider';
    end if;
    return new;
  end if;

  new.is_admin := old.is_admin;
  if new.role in ('admin', 'ops') and new.role is distinct from old.role then
    new.role := old.role;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_privileges on public.profiles;
create trigger profiles_protect_privileges
  before insert or update on public.profiles
  for each row execute function public.protect_profile_privileges();

create or replace function public.guard_driver_application()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  doc_count integer;
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
    select count(distinct doc_type) into doc_count
    from public.driver_documents
    where profile_id = new.profile_id
      and doc_type in (
        'license_front', 'license_back',
        'insurance_front', 'insurance_back',
        'registration',
        'car_front', 'car_back', 'car_left', 'car_right'
      );
    if coalesce(doc_count, 0) < 9 then
      raise exception 'Upload all required documents before submitting for review';
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

drop trigger if exists driver_applications_guard on public.driver_applications;
create trigger driver_applications_guard
  before insert or update on public.driver_applications
  for each row execute function public.guard_driver_application();

-- Existing role=driver profiles keep approval. Disable the guard only for this backfill
-- so a re-run can still insert (the guard blocks non-admin self-approval).
alter table public.driver_applications disable trigger driver_applications_guard;

insert into public.driver_applications (
  profile_id,
  is_student,
  has_car,
  has_insurance,
  wants_extra_money,
  attestation_accepted_at,
  status,
  onboarding_status,
  reviewed_at,
  review_note
)
select
  p.id,
  coalesce(p.student_verified_at is not null, false),
  true,
  true,
  true,
  coalesce(p.created_at, now()),
  'approved',
  'approved',
  now(),
  'Grandfathered existing driver before the approval gate. No documents on file.'
from public.profiles p
where p.role = 'driver'
  and not exists (
    select 1 from public.driver_applications a where a.profile_id = p.id
  );

alter table public.driver_applications enable trigger driver_applications_guard;

create or replace function public.enforce_driver_online_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.online = true and not public.driver_is_approved(new.driver_id) then
    raise exception 'Driver is not approved to go online';
  end if;
  return new;
end;
$$;

drop trigger if exists driver_status_require_approval on public.driver_status;
create trigger driver_status_require_approval
  before insert or update on public.driver_status
  for each row execute function public.enforce_driver_online_approval();

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
    raise exception 'Driver is not approved to receive rides';
  end if;
  return new;
end;
$$;

drop trigger if exists trips_require_approved_driver on public.trips;
create trigger trips_require_approved_driver
  before insert or update on public.trips
  for each row execute function public.enforce_trip_approved_driver();

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

  update public.driver_applications
  set
    onboarding_status = case when decision = 'approve' then 'approved' else 'rejected' end,
    reviewed_at = now(),
    reviewed_by = auth.uid(),
    rejection_reason = case when decision = 'reject' then trim(reason) else null end
  where profile_id = target_profile
  returning * into app;

  if app.id is null then
    raise exception 'Application not found';
  end if;

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

alter table public.driver_documents enable row level security;

drop policy if exists driver_documents_owner_all on public.driver_documents;
create policy driver_documents_owner_all
  on public.driver_documents
  for all
  to authenticated
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

drop policy if exists driver_documents_admin_select on public.driver_documents;
create policy driver_documents_admin_select
  on public.driver_documents
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists driver_applications_admin_all on public.driver_applications;
create policy driver_applications_admin_all
  on public.driver_applications
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists profiles_admin_select on public.profiles;
create policy profiles_admin_select
  on public.profiles
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists vehicles_admin_select on public.vehicles;
create policy vehicles_admin_select
  on public.vehicles
  for select
  to authenticated
  using (public.is_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'driver-documents',
  'driver-documents',
  false,
  8388608,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']::text[]
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists driver_docs_owner_select on storage.objects;
create policy driver_docs_owner_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'driver-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists driver_docs_owner_insert on storage.objects;
create policy driver_docs_owner_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'driver-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists driver_docs_owner_update on storage.objects;
create policy driver_docs_owner_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'driver-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'driver-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists driver_docs_owner_delete on storage.objects;
create policy driver_docs_owner_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'driver-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists driver_docs_admin_read on storage.objects;
create policy driver_docs_admin_read
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'driver-documents'
    and public.is_admin()
  );
