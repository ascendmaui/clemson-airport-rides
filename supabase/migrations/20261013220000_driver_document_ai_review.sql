-- Driver document AI review for license, insurance, registration, and inspection.
-- Stores the model verdict, our confidence, and the plain-language reasons.
-- The model never writes rejected. Admins still approve or reject.
-- Additive. Safe to re-run. Version 20261013220000.

alter table public.driver_documents
  add column if not exists ai_verdict text,
  add column if not exists ai_confidence numeric(4,3),
  add column if not exists ai_reason text,
  add column if not exists ai_reasons jsonb,
  add column if not exists ai_extraction jsonb,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles (id) on delete set null;

do $$
begin
  if to_regclass('public.vehicles') is not null then
    execute 'alter table public.vehicles add column if not exists vin text';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'driver_documents_ai_verdict_check'
  ) then
    alter table public.driver_documents
      add constraint driver_documents_ai_verdict_check
      check (ai_verdict is null or ai_verdict in ('approved', 'needs_admin', 'error', 'unavailable'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'driver_documents_ai_confidence_check'
  ) then
    alter table public.driver_documents
      add constraint driver_documents_ai_confidence_check
      check (ai_confidence is null or (ai_confidence >= 0 and ai_confidence <= 1));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'driver_documents_ai_reason_check'
  ) then
    alter table public.driver_documents
      add constraint driver_documents_ai_reason_check
      check (ai_reason is null or char_length(ai_reason) <= 500);
  end if;
end $$;

create index if not exists driver_documents_ai_pending_idx
  on public.driver_documents (created_at desc)
  where review_status in ('pending_admin_review', 'pending_manual_review');

create or replace function public.guard_driver_document_ai_review()
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
      new.review_status := 'pending_manual_review';
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.ai_verdict := null;
    new.ai_confidence := null;
    new.ai_reason := null;
    new.ai_reasons := null;
    new.ai_extraction := null;
    new.reviewed_at := null;
    new.reviewed_by := null;
    if new.review_status is null
       or btrim(new.review_status) = ''
       or new.review_status in ('approved', 'rejected') then
      new.review_status := 'pending_manual_review';
    end if;
    return new;
  end if;

  if new.storage_path is distinct from old.storage_path then
    new.review_status := 'pending_manual_review';
    new.ai_verdict := null;
    new.ai_confidence := null;
    new.ai_reason := null;
    new.ai_reasons := null;
    new.ai_extraction := null;
    new.reviewed_at := null;
    new.reviewed_by := null;
    return new;
  end if;

  new.review_status := old.review_status;
  new.ai_verdict := old.ai_verdict;
  new.ai_confidence := old.ai_confidence;
  new.ai_reason := old.ai_reason;
  new.ai_reasons := old.ai_reasons;
  new.ai_extraction := old.ai_extraction;
  new.reviewed_at := old.reviewed_at;
  new.reviewed_by := old.reviewed_by;
  new.profile_id := old.profile_id;
  new.doc_type := old.doc_type;
  return new;
end;
$$;

drop trigger if exists driver_documents_ai_review_guard on public.driver_documents;
create trigger driver_documents_ai_review_guard
  before insert or update on public.driver_documents
  for each row execute function public.guard_driver_document_ai_review();

comment on column public.driver_documents.ai_verdict is
  'Model outcome: approved, needs_admin, error, or unavailable. Never a rejection.';
comment on column public.driver_documents.ai_confidence is
  'Confidence from 0 to 1 computed by our checks, not by the model.';
comment on column public.driver_documents.ai_reason is
  'Plain-language reason the document was approved or sent to manual review.';
comment on column public.driver_documents.ai_reasons is
  'List of plain-language reasons behind ai_reason.';
