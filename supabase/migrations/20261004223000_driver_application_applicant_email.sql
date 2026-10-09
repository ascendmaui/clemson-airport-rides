-- Email submitted with a driver application, shown on the web admin Applicants list.
-- Re-runnable: a missing applications table is skipped, the column is added only
-- when absent, and blank addresses are filled without overwriting one already stored.

do $$
begin
  if to_regclass('public.driver_applications') is null then
    return;
  end if;

  execute 'alter table public.driver_applications add column if not exists applicant_email text';

  execute $cmt$
    comment on column public.driver_applications.applicant_email is
      'Email submitted with this driver application. The web admin Applicants list shows this address.'
  $cmt$;

  if to_regclass('public.profiles') is not null then
    execute $upd$
      update public.driver_applications da
      set applicant_email = lower(btrim(p.email))
      from public.profiles p
      where da.profile_id = p.id
        and (da.applicant_email is null or btrim(da.applicant_email) = '')
        and p.email is not null
        and btrim(p.email) <> ''
    $upd$;
  end if;

  if to_regclass('auth.users') is not null then
    execute $upd$
      update public.driver_applications da
      set applicant_email = lower(btrim(u.email::text))
      from auth.users u
      where da.profile_id = u.id
        and (da.applicant_email is null or btrim(da.applicant_email) = '')
        and u.email is not null
        and btrim(u.email::text) <> ''
    $upd$;
  end if;
end $$;
