-- Email submitted with the driver application, shown on the web admin applicant list.

alter table public.driver_applications
  add column if not exists applicant_email text;

comment on column public.driver_applications.applicant_email is
  'Email submitted with this driver application. The admin applicant review list shows this address.';

update public.driver_applications da
set applicant_email = lower(btrim(p.email))
from public.profiles p
where da.profile_id = p.id
  and (da.applicant_email is null or btrim(da.applicant_email) = '')
  and p.email is not null
  and btrim(p.email) <> '';

update public.driver_applications da
set applicant_email = lower(btrim(u.email))
from auth.users u
where da.profile_id = u.id
  and (da.applicant_email is null or btrim(da.applicant_email) = '')
  and u.email is not null
  and btrim(u.email) <> '';

create or replace function public.notify_admin_driver_application()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  who text;
  applicant_email text;
begin
  if new.onboarding_status is distinct from 'pending_review' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.onboarding_status = 'pending_review' then
    return new;
  end if;

  select
    coalesce(nullif(btrim(p.full_name), ''), 'A driver'),
    nullif(btrim(coalesce(new.applicant_email, p.email)), '')
  into who, applicant_email
  from public.profiles p
  where p.id = new.profile_id;

  insert into public.admin_notifications (kind, title, body, entity_type, entity_id)
  values (
    'driver_application',
    'New driver application',
    coalesce(who, 'A driver') || ' submitted an application for review.'
      || case
        when applicant_email is null then ''
        else ' Email: ' || applicant_email
      end,
    'driver_application',
    new.profile_id::text
  );
  return new;
end;
$$;
