-- Align older installations with the existing electronic W-9 and employment forms.
-- Preserve historical uploads, application statuses, and all approved-driver gates.
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

  if not exists (
    select 1
    from public.driver_agreements a
    join public.driver_agreement_versions v on v.version = a.agreement_version
    where a.profile_id = target
      and a.signer_user_id = target
      and a.agreement_version = 'ic-agreement-2026-09-24'
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

