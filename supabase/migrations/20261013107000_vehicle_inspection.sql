-- Vehicle inspection is due 30 days after the four document categories are
-- first approved. It is not part of that initial go-online check.
-- A complete submission (four sides plus a sourced form) unblocks while
-- review is pending. A rejection does not count as submitted.
-- Interior is optional. The deadline is written once and is not moved.

alter table public.driver_documents
  add column if not exists inspection_source text;

alter table public.driver_documents
  drop constraint if exists driver_documents_inspection_source_check;

alter table public.driver_documents
  add constraint driver_documents_inspection_source_check
  check (
    inspection_source is null
    or inspection_source in ('lyft', 'uber', 'other_platform', 'independent')
  );

do $check$
declare
  def text;
begin
  if to_regclass('public.driver_documents') is null then
    return;
  end if;
  select pg_get_constraintdef(c.oid) into def
  from pg_constraint c
  where c.conname = 'driver_documents_doc_type_check'
    and c.conrelid = 'public.driver_documents'::regclass;
  if def is null or position('inspection_front' in def) > 0 then
    return;
  end if;
  alter table public.driver_documents drop constraint driver_documents_doc_type_check;
  alter table public.driver_documents
    add constraint driver_documents_doc_type_check
    check (doc_type in (
      'license_front', 'license_back',
      'insurance_front', 'insurance_back',
      'registration',
      'car_front', 'car_back', 'car_left', 'car_right',
      'inspection_front', 'inspection_back', 'inspection_left', 'inspection_right',
      'inspection_interior', 'inspection_form'
    ));
end
$check$;

do $seed$
begin
  if to_regclass('public.driver_required_documents') is null then
    return;
  end if;
  insert into public.driver_required_documents (doc_type, label, step_id, sort_order)
  values
    ('inspection_front', 'Inspection — front', 'inspection', 20),
    ('inspection_back', 'Inspection — back', 'inspection', 21),
    ('inspection_left', 'Inspection — left side', 'inspection', 22),
    ('inspection_right', 'Inspection — right side', 'inspection', 23),
    ('inspection_interior', 'Inspection — interior', 'inspection', 24),
    ('inspection_form', 'Inspection form', 'inspection', 25)
  on conflict (doc_type) do update
    set label = excluded.label,
        step_id = excluded.step_id,
        sort_order = excluded.sort_order;
end
$seed$;

-- Keep inspection files out of the application packet. They are due later.
do $submission$
begin
  if to_regprocedure('public.driver_submission_ready(uuid)') is null then
    return;
  end if;
  execute $fn$
    create or replace function public.driver_submission_ready(target uuid)
    returns boolean
    language plpgsql
    stable
    security definer
    set search_path = public
    as $body$
    declare
      missing integer;
      app public.driver_applications;
    begin
      select count(*) into missing
      from public.driver_required_documents req
      where req.doc_type not in (
        'background_authorization', 'work_eligibility', 'w9',
        'inspection_front', 'inspection_back', 'inspection_left', 'inspection_right',
        'inspection_interior', 'inspection_form'
      )
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
    $body$;
  $fn$;
end
$submission$;

create table if not exists public.driver_inspection_deadlines (
  profile_id uuid primary key,
  first_approved_at timestamptz not null,
  inspection_due_at timestamptz not null
);

alter table public.driver_inspection_deadlines enable row level security;

do $policy$
begin
  if to_regprocedure('auth.uid()') is null then
    return;
  end if;
  execute 'drop policy if exists driver_inspection_deadlines_select_own on public.driver_inspection_deadlines';
  execute 'create policy driver_inspection_deadlines_select_own on public.driver_inspection_deadlines for select to authenticated using (profile_id = auth.uid())';
end
$policy$;

grant select on public.driver_inspection_deadlines to authenticated, service_role;

create or replace function public.driver_inspection_submitted(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1 from public.driver_documents d
      where d.profile_id = uid
        and d.doc_type = 'inspection_front'
        and btrim(coalesce(d.storage_path, '')) <> ''
        and btrim(coalesce(d.review_status, '')) <> 'rejected'
    )
    and exists (
      select 1 from public.driver_documents d
      where d.profile_id = uid
        and d.doc_type = 'inspection_back'
        and btrim(coalesce(d.storage_path, '')) <> ''
        and btrim(coalesce(d.review_status, '')) <> 'rejected'
    )
    and exists (
      select 1 from public.driver_documents d
      where d.profile_id = uid
        and d.doc_type = 'inspection_left'
        and btrim(coalesce(d.storage_path, '')) <> ''
        and btrim(coalesce(d.review_status, '')) <> 'rejected'
    )
    and exists (
      select 1 from public.driver_documents d
      where d.profile_id = uid
        and d.doc_type = 'inspection_right'
        and btrim(coalesce(d.storage_path, '')) <> ''
        and btrim(coalesce(d.review_status, '')) <> 'rejected'
    )
    and exists (
      select 1 from public.driver_documents d
      where d.profile_id = uid
        and d.doc_type = 'inspection_form'
        and btrim(coalesce(d.storage_path, '')) <> ''
        and btrim(coalesce(d.review_status, '')) <> 'rejected'
        and d.inspection_source in ('lyft', 'uber', 'other_platform', 'independent')
    );
$$;

revoke all on function public.driver_inspection_submitted(uuid) from public;
grant execute on function public.driver_inspection_submitted(uuid) to authenticated, service_role;

create or replace function public.driver_inspection_blocks_online(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.driver_inspection_deadlines d
    where d.profile_id = uid
      and d.inspection_due_at <= now()
  )
  and not public.driver_inspection_submitted(uid);
$$;

revoke all on function public.driver_inspection_blocks_online(uuid) from public;
grant execute on function public.driver_inspection_blocks_online(uuid) to authenticated, service_role;

create or replace function public.stamp_driver_inspection_deadline()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.driver_documents_clear_for_online(new.profile_id) then
    insert into public.driver_inspection_deadlines (profile_id, first_approved_at, inspection_due_at)
    values (new.profile_id, now(), now() + interval '30 days')
    on conflict (profile_id) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.stamp_driver_inspection_deadline() from public;

drop trigger if exists driver_documents_stamp_inspection_deadline on public.driver_documents;
create trigger driver_documents_stamp_inspection_deadline
  after insert or update on public.driver_documents
  for each row execute function public.stamp_driver_inspection_deadline();

create or replace function public.enforce_driver_online_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.online, false) then
    if not public.driver_is_approved(new.driver_id) then
      raise exception 'Finish approval to go online. Your account is still under review.';
    end if;
    if not public.driver_documents_clear_for_online(new.driver_id) then
      if tg_op = 'UPDATE' and coalesce(old.online, false) then
        new.online := false;
      else
        raise exception 'Your documents need approval before you can go online';
      end if;
    elsif public.driver_inspection_blocks_online(new.driver_id) then
      if tg_op = 'UPDATE' and coalesce(old.online, false) then
        new.online := false;
      else
        raise exception 'Your vehicle inspection is overdue. Upload it to go back online';
      end if;
    else
      insert into public.driver_inspection_deadlines (profile_id, first_approved_at, inspection_due_at)
      values (new.driver_id, now(), now() + interval '30 days')
      on conflict (profile_id) do nothing;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_driver_online_approval() from public;

do $$
begin
  if to_regclass('public.driver_status') is null then
    return;
  end if;
  execute 'drop trigger if exists driver_status_require_approval on public.driver_status';
  execute 'create trigger driver_status_require_approval before insert or update on public.driver_status for each row execute function public.enforce_driver_online_approval()';
end;
$$;
