-- Block go-online until every document category is approved.
-- Same rule as categoryAttention: each required doc_type in License, Insurance,
-- Registration, and Vehicle Photos must have review_status exactly 'approved'.
-- Admins and demo accounts are not exempt. The existing go-online approval
-- trigger does not skip them, and demo cars never write driver_status.
-- A driver who is already online is taken offline on the next status write
-- instead of keeping the map pin up. A fresh GO still raises.

create or replace function public.driver_documents_clear_for_online(uid uuid)
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
        and d.doc_type = 'license_front'
        and btrim(coalesce(d.review_status, '')) = 'approved'
    )
    and exists (
      select 1 from public.driver_documents d
      where d.profile_id = uid
        and d.doc_type = 'license_back'
        and btrim(coalesce(d.review_status, '')) = 'approved'
    )
    and exists (
      select 1 from public.driver_documents d
      where d.profile_id = uid
        and d.doc_type = 'insurance_front'
        and btrim(coalesce(d.review_status, '')) = 'approved'
    )
    and exists (
      select 1 from public.driver_documents d
      where d.profile_id = uid
        and d.doc_type = 'insurance_back'
        and btrim(coalesce(d.review_status, '')) = 'approved'
    )
    and exists (
      select 1 from public.driver_documents d
      where d.profile_id = uid
        and d.doc_type = 'registration'
        and btrim(coalesce(d.review_status, '')) = 'approved'
    )
    and exists (
      select 1 from public.driver_documents d
      where d.profile_id = uid
        and d.doc_type = 'car_front'
        and btrim(coalesce(d.review_status, '')) = 'approved'
    )
    and exists (
      select 1 from public.driver_documents d
      where d.profile_id = uid
        and d.doc_type = 'car_back'
        and btrim(coalesce(d.review_status, '')) = 'approved'
    )
    and exists (
      select 1 from public.driver_documents d
      where d.profile_id = uid
        and d.doc_type = 'car_left'
        and btrim(coalesce(d.review_status, '')) = 'approved'
    )
    and exists (
      select 1 from public.driver_documents d
      where d.profile_id = uid
        and d.doc_type = 'car_right'
        and btrim(coalesce(d.review_status, '')) = 'approved'
    );
$$;

revoke all on function public.driver_documents_clear_for_online(uuid) from public;
grant execute on function public.driver_documents_clear_for_online(uuid) to authenticated, service_role;

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
