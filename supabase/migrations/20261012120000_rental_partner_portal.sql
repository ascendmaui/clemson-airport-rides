-- Rental Partner portal (additive). Partners list vehicles; eligible drivers
-- browse approved listings and send interest requests. No payments in v1.
-- Vehicle rules mirror shared/vehicleStandards.js (VEHICLE_STANDARD_MIN_YEAR = 2019).

create table if not exists public.rental_partners (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique,
  business_name text not null,
  contact_name text not null,
  phone text not null,
  email text not null,
  city text not null,
  service_area text not null,
  terms_version text not null,
  terms_accepted_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','approved','rejected','suspended')),
  review_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rental_listings (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.rental_partners(id) on delete cascade,
  make text not null,
  model text not null,
  year int not null check (year between 1980 and 2100),
  body_style text not null,
  seats int not null check (seats between 2 and 15),
  vin text not null check (vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  title_status text not null check (title_status in ('clean','rebuilt','salvage')),
  mileage int not null check (mileage >= 0),
  photos text[] not null default '{}',
  condition text not null check (condition in ('excellent','good','fair','poor')),
  condition_photos jsonb not null default '{}'::jsonb,
  inspection_kind text not null check (inspection_kind in ('upload','attestation')),
  inspection_doc_path text,
  inspection_attested boolean not null default false,
  registration_expires date not null,
  insurance_expires date not null,
  weekly_price_cents int not null check (weekly_price_cents >= 1000),
  deposit_cents int not null default 0 check (deposit_cents >= 0),
  mileage_limit_weekly int check (mileage_limit_weekly is null or mileage_limit_weekly >= 0),
  insurance_included boolean not null default false,
  maintenance_included boolean not null default false,
  basics_included boolean not null default false,
  min_driver_age int not null default 21 check (min_driver_age between 18 and 30),
  available_from date not null default current_date,
  available_until date,
  pickup_location text not null,
  luxury_exception boolean not null default false,
  luxury_note text,
  luxury_photos text[] not null default '{}',
  status text not null default 'active' check (status in ('active','paused')),
  review_status text not null default 'pending_admin_review'
    check (review_status in ('approved','pending_admin_review','rejected')),
  review_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists rental_listings_partner_idx on public.rental_listings(partner_id);

create table if not exists public.rental_requests (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.rental_listings(id) on delete cascade,
  partner_id uuid not null references public.rental_partners(id) on delete cascade,
  driver_id uuid not null,
  status text not null default 'requested'
    check (status in ('requested','accepted','declined','active','ended','canceled')),
  message text,
  start_date date,
  end_date date,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);
create index if not exists rental_requests_partner_idx on public.rental_requests(partner_id);
create index if not exists rental_requests_driver_idx on public.rental_requests(driver_id);
create unique index if not exists rental_requests_one_open
  on public.rental_requests(listing_id, driver_id)
  where status in ('requested','accepted','active');

-- ---------- helpers ----------
create or replace function public.rental_partner_id_for(uid uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.rental_partners where profile_id = uid
$$;

create or replace function public.rental_partner_approved(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.rental_partners where profile_id = uid and status = 'approved')
$$;

-- Definer helpers so policies can look across tables without tripping their RLS.
create or replace function public.rental_partner_is_approved(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.rental_partners where id = pid and status = 'approved')
$$;

create or replace function public.rental_listing_requestable(lid uuid, pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.rental_listings l join public.rental_partners p on p.id = l.partner_id
    where l.id = lid and l.partner_id = pid
      and l.status = 'active' and l.review_status = 'approved' and p.status = 'approved'
  )
$$;

-- License reviewed (onboarding approved) + background attestation passed.
create or replace function public.rental_driver_eligible(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.driver_applications a
    where a.profile_id = uid
      and a.onboarding_status = 'approved'
      and (a.background_check_status = 'authorized'
           or (a.background_check_status = 'needs_review' and a.background_admin_reviewed_at is not null))
  )
$$;

-- ---------- triggers ----------
-- Invoker-rights on purpose: current_user must be the caller's role.
create or replace function public.rental_partner_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if public.is_admin() or current_user in ('service_role','postgres','supabase_admin') then
    if tg_op = 'UPDATE' and new.status is distinct from old.status then
      new.reviewed_at := now();
      new.reviewed_by := coalesce(auth.uid(), new.reviewed_by);
    end if;
    new.updated_at := now();
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.status := 'pending';
    new.reviewed_by := null; new.reviewed_at := null; new.review_note := null;
  else
    new.status := old.status;
    new.profile_id := old.profile_id;
    new.reviewed_by := old.reviewed_by; new.reviewed_at := old.reviewed_at; new.review_note := old.review_note;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists rental_partner_guard on public.rental_partners;
create trigger rental_partner_guard before insert or update on public.rental_partners
  for each row execute function public.rental_partner_guard();

-- Vehicle standards, enforced in the database too.
create or replace function public.rental_listing_enforce_standards()
returns trigger language plpgsql set search_path = public as $$
declare
  min_year constant int := 2019;
  privileged boolean := public.is_admin() or current_user in ('service_role','postgres','supabase_admin');
  slot text;
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and privileged and new.review_status is distinct from old.review_status then
    new.reviewed_at := now();
    new.reviewed_by := coalesce(auth.uid(), new.reviewed_by);
    if new.review_status = 'approved' and (new.condition = 'poor' or new.title_status = 'salvage') then
      raise exception 'Poor-condition or salvage vehicles cannot be approved';
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and not privileged then
    new.partner_id := old.partner_id;
    new.reviewed_by := old.reviewed_by; new.reviewed_at := old.reviewed_at; new.review_note := old.review_note;
  end if;

  if new.title_status = 'salvage' then raise exception 'Salvage titles are not allowed'; end if;
  if new.registration_expires < current_date then raise exception 'Registration is expired'; end if;
  if new.insurance_expires < current_date then raise exception 'Insurance is expired'; end if;
  if new.inspection_kind = 'upload' and coalesce(new.inspection_doc_path,'') = '' then
    raise exception 'Inspection report upload is required';
  end if;
  if new.inspection_kind = 'attestation' and not new.inspection_attested then
    raise exception 'Inspection attestation is required';
  end if;
  foreach slot in array array['front','back','left','right','interior'] loop
    if coalesce(new.condition_photos->>slot, '') = '' then
      raise exception 'Condition photo missing: %', slot;
    end if;
  end loop;

  -- Only re-derive review status when vehicle facts change (pause/unpause keeps it).
  if tg_op = 'UPDATE' and not privileged
     and (new.year, new.condition, new.luxury_exception, new.vin, new.title_status, new.make, new.model)
         is not distinct from (old.year, old.condition, old.luxury_exception, old.vin, old.title_status, old.make, old.model)
     and new.condition_photos = old.condition_photos then
    new.review_status := old.review_status;
    return new;
  end if;

  if new.condition = 'poor' then
    new.review_status := 'rejected';
    new.review_note := 'Auto-rejected: self-reported poor condition.';
  elsif new.year < min_year then
    if not new.luxury_exception then
      raise exception 'Vehicles older than % need a Luxury exception', min_year;
    end if;
    if coalesce(array_length(new.luxury_photos, 1), 0) = 0 or length(coalesce(new.luxury_note, '')) < 10 then
      raise exception 'Luxury exception needs photos and a note';
    end if;
    new.review_status := 'pending_admin_review';
  elsif not privileged then
    new.review_status := 'approved';
  end if;
  return new;
end $$;
drop trigger if exists rental_listing_enforce_standards on public.rental_listings;
create trigger rental_listing_enforce_standards before insert or update on public.rental_listings
  for each row execute function public.rental_listing_enforce_standards();

-- ---------- RLS ----------
alter table public.rental_partners enable row level security;
alter table public.rental_listings enable row level security;
alter table public.rental_requests enable row level security;

revoke all on public.rental_partners, public.rental_listings, public.rental_requests from anon;
grant select, insert, update on public.rental_partners to authenticated;
grant select, insert, update on public.rental_listings to authenticated;
grant select, insert on public.rental_requests to authenticated;
grant all on public.rental_partners, public.rental_listings, public.rental_requests to service_role;

drop policy if exists rental_partners_admin_all on public.rental_partners;
create policy rental_partners_admin_all on public.rental_partners for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists rental_partners_own_select on public.rental_partners;
create policy rental_partners_own_select on public.rental_partners for select to authenticated
  using (profile_id = auth.uid());
drop policy if exists rental_partners_own_insert on public.rental_partners;
create policy rental_partners_own_insert on public.rental_partners for insert to authenticated
  with check (profile_id = auth.uid());
drop policy if exists rental_partners_own_update on public.rental_partners;
create policy rental_partners_own_update on public.rental_partners for update to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

drop policy if exists rental_listings_admin_all on public.rental_listings;
create policy rental_listings_admin_all on public.rental_listings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists rental_listings_partner_select on public.rental_listings;
create policy rental_listings_partner_select on public.rental_listings for select to authenticated
  using (partner_id = public.rental_partner_id_for(auth.uid()));
drop policy if exists rental_listings_partner_insert on public.rental_listings;
create policy rental_listings_partner_insert on public.rental_listings for insert to authenticated
  with check (partner_id = public.rental_partner_id_for(auth.uid()) and public.rental_partner_approved(auth.uid()));
drop policy if exists rental_listings_partner_update on public.rental_listings;
create policy rental_listings_partner_update on public.rental_listings for update to authenticated
  using (partner_id = public.rental_partner_id_for(auth.uid()))
  with check (partner_id = public.rental_partner_id_for(auth.uid()) and public.rental_partner_approved(auth.uid()));
drop policy if exists rental_listings_driver_browse on public.rental_listings;
create policy rental_listings_driver_browse on public.rental_listings for select to authenticated
  using (
    status = 'active' and review_status = 'approved'
    and (available_until is null or available_until >= current_date)
    and public.rental_partner_is_approved(partner_id)
    and public.rental_driver_eligible(auth.uid())
  );

drop policy if exists rental_requests_admin_all on public.rental_requests;
create policy rental_requests_admin_all on public.rental_requests for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists rental_requests_driver_select on public.rental_requests;
create policy rental_requests_driver_select on public.rental_requests for select to authenticated
  using (driver_id = auth.uid());
drop policy if exists rental_requests_partner_select on public.rental_requests;
create policy rental_requests_partner_select on public.rental_requests for select to authenticated
  using (partner_id = public.rental_partner_id_for(auth.uid()));
drop policy if exists rental_requests_driver_insert on public.rental_requests;
create policy rental_requests_driver_insert on public.rental_requests for insert to authenticated
  with check (
    driver_id = auth.uid() and status = 'requested'
    and public.rental_driver_eligible(auth.uid())
    and public.rental_listing_requestable(listing_id, partner_id)
  );

-- State machine (mirrors shared/rentalStateMachine.js). No direct UPDATE grant.
create or replace function public.rental_request_transition(p_request uuid, p_to text, p_start date default null, p_end date default null)
returns public.rental_requests language plpgsql security definer set search_path = public as $$
declare
  r public.rental_requests;
  actor text;
  ok boolean := false;
begin
  select * into r from public.rental_requests where id = p_request for update;
  if not found then raise exception 'Rental request not found'; end if;
  if public.is_admin() then actor := 'admin';
  elsif r.partner_id = public.rental_partner_id_for(auth.uid()) then actor := 'partner';
  elsif r.driver_id = auth.uid() then actor := 'driver';
  else raise exception 'Not allowed';
  end if;
  ok := case
    when r.status = 'requested' and p_to in ('accepted','declined') then actor in ('partner','admin')
    when r.status = 'requested' and p_to = 'canceled' then actor in ('driver','admin')
    when r.status = 'accepted' and p_to = 'active' then actor in ('partner','admin')
    when r.status = 'accepted' and p_to = 'canceled' then actor in ('driver','partner','admin')
    when r.status = 'active' and p_to = 'ended' then actor in ('partner','driver','admin')
    else false end;
  if not ok then raise exception 'Cannot move a % request to %', r.status, p_to; end if;
  update public.rental_requests set
    status = p_to,
    updated_at = now(),
    accepted_at = case when p_to = 'accepted' then now() else accepted_at end,
    start_date = case when p_to = 'active' then coalesce(p_start, start_date, current_date) else start_date end,
    end_date = case when p_to = 'active' then coalesce(p_end, end_date)
                    when p_to = 'ended' then coalesce(p_end, current_date) else end_date end
  where id = p_request returning * into r;
  return r;
end $$;

-- Partner view of interested drivers: contact only after accept.
create or replace function public.rental_request_driver_card(p_request uuid)
returns table (request_id uuid, full_name text, rating_avg numeric, rating_count int,
               check_status text, phone text, email text)
language plpgsql stable security definer set search_path = public as $$
declare r public.rental_requests;
begin
  select * into r from public.rental_requests where id = p_request;
  if not found then return; end if;
  if not (public.is_admin() or r.partner_id = public.rental_partner_id_for(auth.uid())) then
    raise exception 'Not allowed';
  end if;
  return query
    select r.id, p.full_name, p.rating_avg, p.rating_count,
      case when public.rental_driver_eligible(r.driver_id) then 'license and background passed' else 'not cleared' end,
      case when r.status in ('accepted','active','ended') then p.phone end,
      case when r.status in ('accepted','active','ended') then p.email end
    from public.profiles p where p.id = r.driver_id;
end $$;

revoke all on function public.rental_request_transition(uuid, text, date, date) from public, anon;
revoke all on function public.rental_request_driver_card(uuid) from public, anon;
revoke all on function public.rental_driver_eligible(uuid) from public, anon;
revoke all on function public.rental_partner_id_for(uuid) from public, anon;
revoke all on function public.rental_partner_approved(uuid) from public, anon;
grant execute on function public.rental_request_transition(uuid, text, date, date) to authenticated, service_role;
grant execute on function public.rental_request_driver_card(uuid) to authenticated, service_role;
grant execute on function public.rental_driver_eligible(uuid) to authenticated, service_role;
grant execute on function public.rental_partner_id_for(uuid) to authenticated, service_role;
grant execute on function public.rental_partner_approved(uuid) to authenticated, service_role;
revoke all on function public.rental_listing_requestable(uuid, uuid) from public, anon;
grant execute on function public.rental_listing_requestable(uuid, uuid) to authenticated, service_role;
revoke all on function public.rental_partner_is_approved(uuid) from public, anon;
grant execute on function public.rental_partner_is_approved(uuid) to authenticated, service_role;

-- ---------- storage (skipped where the storage schema does not exist, e.g. tests) ----------
do $$
begin
  if to_regclass('storage.buckets') is null then return; end if;
  insert into storage.buckets (id, name, public) values ('rental-photos', 'rental-photos', true)
    on conflict (id) do nothing;
  insert into storage.buckets (id, name, public) values ('rental-docs', 'rental-docs', false)
    on conflict (id) do nothing;
  execute 'drop policy if exists rental_photos_owner_write on storage.objects';
  execute $p$create policy rental_photos_owner_write on storage.objects for insert to authenticated
    with check (bucket_id in ('rental-photos','rental-docs') and (storage.foldername(name))[1] = auth.uid()::text)$p$;
  execute 'drop policy if exists rental_photos_owner_update on storage.objects';
  execute $p$create policy rental_photos_owner_update on storage.objects for update to authenticated
    using (bucket_id in ('rental-photos','rental-docs') and (storage.foldername(name))[1] = auth.uid()::text)$p$;
  execute 'drop policy if exists rental_docs_owner_admin_read on storage.objects';
  execute $p$create policy rental_docs_owner_admin_read on storage.objects for select to authenticated
    using (bucket_id = 'rental-docs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()))$p$;
end $$;
