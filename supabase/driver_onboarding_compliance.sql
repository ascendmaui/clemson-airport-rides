-- Employment verification, W-9 (TIN last-4 in the app, full TIN in a locked table),
-- and the electronically signed independent contractor agreement.
-- Additive. Safe to re-run. Does not drop existing driver data.

create table if not exists public.driver_required_documents (
  doc_type text primary key,
  label text not null,
  step_id text not null,
  sort_order integer not null
);

insert into public.driver_required_documents (doc_type, label, step_id, sort_order)
values
  ('license_front', 'Driver license — front', 'license', 1),
  ('license_back', 'Driver license — back', 'license', 2),
  ('insurance_front', 'Insurance card — front', 'insurance', 3),
  ('insurance_back', 'Insurance card — back', 'insurance', 4),
  ('registration', 'Car registration', 'registration', 5),
  ('car_front', 'Car — front', 'car', 6),
  ('car_back', 'Car — back', 'car', 7),
  ('car_left', 'Car — left side', 'car', 8),
  ('car_right', 'Car — right side', 'car', 9),
  ('background_authorization', 'Background-check authorization', 'employment', 10),
  ('work_eligibility', 'Eligibility to work', 'employment', 11),
  ('w9', 'Form W-9', 'w9', 12)
on conflict (doc_type) do update
  set label = excluded.label,
      step_id = excluded.step_id,
      sort_order = excluded.sort_order;

alter table public.driver_documents drop constraint if exists driver_documents_doc_type_check;
alter table public.driver_documents drop constraint if exists driver_documents_doc_type_fkey;
alter table public.driver_documents
  add constraint driver_documents_doc_type_fkey
  foreign key (doc_type) references public.driver_required_documents (doc_type);

alter table public.driver_applications
  add column if not exists background_authorized_at timestamptz,
  add column if not exists work_eligibility_attested_at timestamptz,
  add column if not exists work_eligibility_category text;

alter table public.driver_applications
  drop constraint if exists driver_applications_work_eligibility_category_check;
alter table public.driver_applications
  add constraint driver_applications_work_eligibility_category_check
  check (
    work_eligibility_category is null
    or work_eligibility_category in ('citizen', 'noncitizen_national', 'permanent_resident', 'alien_authorized')
  );

create table if not exists public.driver_tax_info (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  legal_name text not null,
  tin_last4 text not null,
  tax_classification text not null,
  updated_at timestamptz not null default now(),
  constraint driver_tax_info_last4_check check (tin_last4 ~ '^[0-9]{4}$'),
  constraint driver_tax_info_classification_check check (tax_classification in ('individual', 'llc', 'c_corp', 's_corp', 'partnership', 'other'))
);

create table if not exists public.driver_tax_secrets (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  tin text not null,
  updated_at timestamptz not null default now(),
  constraint driver_tax_secrets_tin_check check (tin ~ '^[0-9]{9}$')
);

comment on table public.driver_tax_secrets is
  'Full taxpayer identification number. No client policies. Read only inside save_driver_tax_info.';

create table if not exists public.driver_agreement_versions (
  version text primary key,
  title text not null,
  body_html text not null,
  sha256 text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.driver_agreements (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  agreement_version text not null references public.driver_agreement_versions (version),
  agreement_sha256 text not null,
  signature_name text not null,
  signed_at timestamptz not null default now(),
  signer_user_id uuid not null,
  html_snapshot text not null,
  constraint driver_agreements_profile_version_key unique (profile_id, agreement_version)
);

create index if not exists driver_agreements_profile_idx
  on public.driver_agreements (profile_id);

insert into public.driver_agreement_versions (version, title, body_html, sha256)
values (
  'ic-agreement-2026-09-23',
  'Clemson RIDES Independent Contractor Agreement',
  $html$<h1>Clemson RIDES Independent Contractor Agreement</h1><p>Version ic-agreement-2026-09-23</p><p>This Independent Contractor Agreement ("Agreement") is between you ("Driver") and the Clemson RIDES platform ("Platform"). It takes effect when you electronically sign it during driver onboarding.</p><h2>1. Independent contractor</h2><p>You are an independent contractor, not an employee, partner, agent, or joint venturer of the Platform. You decide whether to use the Platform and whether to accept a ride request. The Platform does not control your hours, route choices, or the manner in which you drive, except for safety rules required to stay on the Platform.</p><h2>2. Eligibility and documents</h2><p>You agree to provide a valid driver license, proof of current auto insurance, vehicle registration, vehicle photos, a background-check authorization, proof of eligibility to work, and a Form W-9 or equivalent tax certification. You agree the documents are genuine and relate to you. The Platform may refuse or remove access if documents are missing, expired, or do not match.</p><h2>3. Background check</h2><p>You authorize the Platform and its screening providers to obtain consumer reports and motor-vehicle records as allowed by law, now and from time to time while you drive on the Platform.</p><h2>4. Your vehicle and insurance</h2><p>You supply the vehicle. You keep it in safe condition and you maintain the insurance required by law and by this Platform. You are responsible for traffic citations, tolls, parking, and damage arising from your driving.</p><h2>5. Taxes</h2><p>You are responsible for your own income taxes, self-employment taxes, and any other taxes. The Platform may issue Form 1099-NEC or other information returns when required. You will keep your W-9 information accurate. You understand the Platform stores your taxpayer identification number in a restricted record and shows only the last four digits in the app.</p><h2>6. Payment</h2><p>Any amount the Platform pays you is contractor compensation for completed trips, not wages. The Platform may withhold a service fee disclosed in the app. You are not eligible for employee benefits.</p><h2>7. Conduct</h2><p>You will follow applicable traffic laws, the Platform rider-safety rules, and the student-ride rules described in the app. You will not discriminate against riders. You will not share another person's documents or account.</p><h2>8. Electronic signature</h2><p>By typing your legal name and submitting this step, you agree this electronic signature is the legal equivalent of a handwritten signature. The Platform stores your typed name, the time you signed, your user id, this agreement version, and a hash of this text.</p><h2>9. Term</h2><p>This Agreement continues until you or the Platform end it. The Platform may suspend or end access when required for safety, missing documents, or a rejected application. Ending this Agreement does not by itself erase records the Platform must keep.</p><h2>10. Entire agreement</h2><p>This is the contractor agreement for driving on Clemson RIDES. It does not create an employment relationship. If a section is unenforceable, the rest remains in effect.</p>$html$,
  encode(extensions.digest(convert_to($html$<h1>Clemson RIDES Independent Contractor Agreement</h1><p>Version ic-agreement-2026-09-23</p><p>This Independent Contractor Agreement ("Agreement") is between you ("Driver") and the Clemson RIDES platform ("Platform"). It takes effect when you electronically sign it during driver onboarding.</p><h2>1. Independent contractor</h2><p>You are an independent contractor, not an employee, partner, agent, or joint venturer of the Platform. You decide whether to use the Platform and whether to accept a ride request. The Platform does not control your hours, route choices, or the manner in which you drive, except for safety rules required to stay on the Platform.</p><h2>2. Eligibility and documents</h2><p>You agree to provide a valid driver license, proof of current auto insurance, vehicle registration, vehicle photos, a background-check authorization, proof of eligibility to work, and a Form W-9 or equivalent tax certification. You agree the documents are genuine and relate to you. The Platform may refuse or remove access if documents are missing, expired, or do not match.</p><h2>3. Background check</h2><p>You authorize the Platform and its screening providers to obtain consumer reports and motor-vehicle records as allowed by law, now and from time to time while you drive on the Platform.</p><h2>4. Your vehicle and insurance</h2><p>You supply the vehicle. You keep it in safe condition and you maintain the insurance required by law and by this Platform. You are responsible for traffic citations, tolls, parking, and damage arising from your driving.</p><h2>5. Taxes</h2><p>You are responsible for your own income taxes, self-employment taxes, and any other taxes. The Platform may issue Form 1099-NEC or other information returns when required. You will keep your W-9 information accurate. You understand the Platform stores your taxpayer identification number in a restricted record and shows only the last four digits in the app.</p><h2>6. Payment</h2><p>Any amount the Platform pays you is contractor compensation for completed trips, not wages. The Platform may withhold a service fee disclosed in the app. You are not eligible for employee benefits.</p><h2>7. Conduct</h2><p>You will follow applicable traffic laws, the Platform rider-safety rules, and the student-ride rules described in the app. You will not discriminate against riders. You will not share another person's documents or account.</p><h2>8. Electronic signature</h2><p>By typing your legal name and submitting this step, you agree this electronic signature is the legal equivalent of a handwritten signature. The Platform stores your typed name, the time you signed, your user id, this agreement version, and a hash of this text.</p><h2>9. Term</h2><p>This Agreement continues until you or the Platform end it. The Platform may suspend or end access when required for safety, missing documents, or a rejected application. Ending this Agreement does not by itself erase records the Platform must keep.</p><h2>10. Entire agreement</h2><p>This is the contractor agreement for driving on Clemson RIDES. It does not create an employment relationship. If a section is unenforceable, the rest remains in effect.</p>$html$, 'UTF8'), 'sha256'), 'hex')
)
on conflict (version) do update
  set title = excluded.title,
      body_html = excluded.body_html,
      sha256 = excluded.sha256;

create or replace function public.save_driver_tax_info(
  legal_name text,
  tin text,
  tax_classification text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  digits text;
  last4 text;
  cleaned_name text;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  digits := regexp_replace(coalesce(tin, ''), '[^0-9]', '', 'g');
  if length(digits) <> 9 then
    raise exception 'TIN must be 9 digits';
  end if;
  cleaned_name := trim(coalesce(legal_name, ''));
  if length(cleaned_name) < 2 then
    raise exception 'Legal name is required';
  end if;
  if tax_classification not in ('individual', 'llc', 'c_corp', 's_corp', 'partnership', 'other') then
    raise exception 'Choose a tax classification';
  end if;
  last4 := right(digits, 4);

  insert into public.driver_tax_secrets (profile_id, tin, updated_at)
  values (auth.uid(), digits, now())
  on conflict (profile_id) do update
    set tin = excluded.tin,
        updated_at = now();

  insert into public.driver_tax_info (profile_id, legal_name, tin_last4, tax_classification, updated_at)
  values (auth.uid(), cleaned_name, last4, tax_classification, now())
  on conflict (profile_id) do update
    set legal_name = excluded.legal_name,
        tin_last4 = excluded.tin_last4,
        tax_classification = excluded.tax_classification,
        updated_at = now();

  return jsonb_build_object(
    'legal_name', cleaned_name,
    'tin_last4', last4,
    'tax_classification', tax_classification
  );
end;
$$;

revoke all on function public.save_driver_tax_info(text, text, text) from public;
grant execute on function public.save_driver_tax_info(text, text, text) to authenticated;

create or replace function public.sign_driver_agreement(signature_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ver public.driver_agreement_versions;
  signed_name text;
  signed_at timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  signed_name := trim(coalesce(signature_name, ''));
  if length(signed_name) < 2 then
    raise exception 'Type your legal name to sign';
  end if;

  select * into ver
  from public.driver_agreement_versions
  where version = 'ic-agreement-2026-09-23';

  if ver.version is null then
    raise exception 'Agreement is not available';
  end if;

  insert into public.driver_agreements (
    profile_id,
    agreement_version,
    agreement_sha256,
    signature_name,
    signed_at,
    signer_user_id,
    html_snapshot
  )
  values (
    auth.uid(),
    ver.version,
    ver.sha256,
    signed_name,
    signed_at,
    auth.uid(),
    ver.body_html
  )
  on conflict (profile_id, agreement_version) do update
    set agreement_sha256 = excluded.agreement_sha256,
        signature_name = excluded.signature_name,
        signed_at = excluded.signed_at,
        signer_user_id = excluded.signer_user_id,
        html_snapshot = excluded.html_snapshot;

  return jsonb_build_object(
    'agreement_version', ver.version,
    'agreement_sha256', ver.sha256,
    'signature_name', signed_name,
    'signed_at', signed_at,
    'signer_user_id', auth.uid()
  );
end;
$$;

revoke all on function public.sign_driver_agreement(text) from public;
grant execute on function public.sign_driver_agreement(text) to authenticated;

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
  where not exists (
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

  if not exists (
    select 1
    from public.driver_agreements a
    join public.driver_agreement_versions v on v.version = a.agreement_version
    where a.profile_id = target
      and a.signer_user_id = target
      and a.agreement_version = 'ic-agreement-2026-09-23'
      and a.agreement_sha256 = v.sha256
      and a.html_snapshot = v.body_html
      and length(trim(a.signature_name)) >= 2
  ) then
    return false;
  end if;

  return true;
end;
$$;

revoke all on function public.driver_submission_ready(uuid) from public;
grant execute on function public.driver_submission_ready(uuid) to authenticated, service_role;

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
      raise exception 'Upload all required documents, tax info, and a signed agreement before submitting for review';
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
     and not public.driver_submission_ready(target_profile) then
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

alter table public.driver_tax_secrets enable row level security;
alter table public.driver_tax_info enable row level security;
alter table public.driver_agreements enable row level security;
alter table public.driver_agreement_versions enable row level security;
alter table public.driver_required_documents enable row level security;

revoke all on table public.driver_tax_secrets from public, anon, authenticated;
grant all on table public.driver_tax_secrets to service_role;

grant select on table public.driver_tax_info to authenticated;
grant all on table public.driver_tax_info to service_role;
grant select on table public.driver_agreements to authenticated;
grant all on table public.driver_agreements to service_role;
grant select on table public.driver_agreement_versions to authenticated;
grant all on table public.driver_agreement_versions to service_role;
grant select on table public.driver_required_documents to authenticated, service_role;

drop policy if exists driver_tax_info_owner_select on public.driver_tax_info;
create policy driver_tax_info_owner_select
  on public.driver_tax_info
  for select
  to authenticated
  using (auth.uid() = profile_id or public.is_admin());

drop policy if exists driver_agreements_owner_select on public.driver_agreements;
create policy driver_agreements_owner_select
  on public.driver_agreements
  for select
  to authenticated
  using (auth.uid() = profile_id or public.is_admin());

drop policy if exists driver_agreement_versions_read on public.driver_agreement_versions;
create policy driver_agreement_versions_read
  on public.driver_agreement_versions
  for select
  to authenticated
  using (true);

drop policy if exists driver_required_documents_read on public.driver_required_documents;
create policy driver_required_documents_read
  on public.driver_required_documents
  for select
  to authenticated
  using (true);
