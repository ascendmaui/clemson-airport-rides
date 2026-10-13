-- Driver profile photo AI review.
-- Stores the model verdict, confidence, and reason. Admins still approve or
-- reject. The model never writes rejected.
-- Additive. Safe to re-run. Version 20261013180000.

create table if not exists public.driver_profile_photos (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  storage_path text not null,
  review_status text not null default 'pending_admin_review',
  created_at timestamptz not null default now()
);

alter table public.driver_profile_photos
  add column if not exists ai_verdict text,
  add column if not exists ai_confidence numeric(4,3),
  add column if not exists ai_reason text,
  add column if not exists review_note text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles (id) on delete set null;

alter table public.driver_profile_photos
  alter column review_status set default 'pending_admin_review';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'driver_profile_photos_review_status_check'
  ) then
    alter table public.driver_profile_photos
      add constraint driver_profile_photos_review_status_check
      check (review_status in ('pending_manual_review', 'pending_admin_review', 'approved', 'rejected'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'driver_profile_photos_ai_verdict_check'
  ) then
    alter table public.driver_profile_photos
      add constraint driver_profile_photos_ai_verdict_check
      check (ai_verdict is null or ai_verdict in ('approved', 'needs_admin', 'error', 'unavailable'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'driver_profile_photos_ai_confidence_check'
  ) then
    alter table public.driver_profile_photos
      add constraint driver_profile_photos_ai_confidence_check
      check (ai_confidence is null or (ai_confidence >= 0 and ai_confidence <= 1));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'driver_profile_photos_ai_reason_check'
  ) then
    alter table public.driver_profile_photos
      add constraint driver_profile_photos_ai_reason_check
      check (ai_reason is null or char_length(ai_reason) <= 500);
  end if;
end $$;

create index if not exists driver_profile_photos_pending_idx
  on public.driver_profile_photos (created_at desc)
  where review_status in ('pending_admin_review', 'pending_manual_review');

create or replace function public.guard_driver_profile_photo_status()
returns trigger
language plpgsql
as $$
declare
  actor text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    current_user
  );
begin
  if actor in ('service_role', 'postgres', 'supabase_admin') then
    if new.review_status is null or btrim(new.review_status) = '' then
      new.review_status := 'pending_admin_review';
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.review_status := 'pending_admin_review';
    new.ai_verdict := null;
    new.ai_confidence := null;
    new.ai_reason := null;
    new.review_note := null;
    new.reviewed_at := null;
    new.reviewed_by := null;
    return new;
  end if;

  new.review_status := old.review_status;
  new.ai_verdict := old.ai_verdict;
  new.ai_confidence := old.ai_confidence;
  new.ai_reason := old.ai_reason;
  new.review_note := old.review_note;
  new.reviewed_at := old.reviewed_at;
  new.reviewed_by := old.reviewed_by;
  new.profile_id := old.profile_id;
  new.storage_path := old.storage_path;
  return new;
end;
$$;

drop trigger if exists driver_profile_photos_status_guard on public.driver_profile_photos;
create trigger driver_profile_photos_status_guard
  before insert or update on public.driver_profile_photos
  for each row execute function public.guard_driver_profile_photo_status();

alter table public.driver_profile_photos enable row level security;

drop policy if exists driver_profile_photos_owner on public.driver_profile_photos;
create policy driver_profile_photos_owner
  on public.driver_profile_photos
  for select
  to authenticated
  using (auth.uid() = profile_id);

drop policy if exists driver_profile_photos_owner_insert on public.driver_profile_photos;
create policy driver_profile_photos_owner_insert
  on public.driver_profile_photos
  for insert
  to authenticated
  with check (auth.uid() = profile_id);

drop policy if exists driver_profile_photos_admin on public.driver_profile_photos;
create policy driver_profile_photos_admin
  on public.driver_profile_photos
  for select
  to authenticated
  using (public.is_admin());

grant select, insert on table public.driver_profile_photos to authenticated;
grant select, insert, update on table public.driver_profile_photos to service_role;

comment on column public.driver_profile_photos.ai_verdict is
  'Model outcome: approved, needs_admin, error, or unavailable. Never a rejection.';
comment on column public.driver_profile_photos.ai_confidence is
  'Model confidence from 0 to 1. Null when the model did not run.';
comment on column public.driver_profile_photos.ai_reason is
  'Why the model approved the photo or sent it to an admin.';
