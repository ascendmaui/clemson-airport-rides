-- Driver Learning Center quiz result.
-- A passing score does not approve the application or change profiles.role.
-- Going online and accepting rides stay on onboarding_status = approved.

alter table public.driver_applications
  add column if not exists quiz_score integer,
  add column if not exists quiz_passed_at timestamptz,
  add column if not exists quiz_attempted_at timestamptz;

alter table public.driver_applications
  drop constraint if exists driver_applications_quiz_score_check;

alter table public.driver_applications
  add constraint driver_applications_quiz_score_check
  check (quiz_score is null or (quiz_score >= 0 and quiz_score <= 100));

comment on column public.driver_applications.quiz_score is
  'Latest Learning Center score, 0–100. A later pass replaces a fail. A saved pass is kept.';
comment on column public.driver_applications.quiz_passed_at is
  'Set when quiz_score is at least 80. Null means not passed. Does not approve the driver.';
comment on column public.driver_applications.quiz_attempted_at is
  'When the signed-in driver last submitted the Learning Center quiz.';

create or replace function public.guard_driver_knowledge_quiz()
returns trigger
language plpgsql
as $$
begin
  if new.quiz_score is not null and (new.quiz_score < 0 or new.quiz_score > 100) then
    raise exception 'quiz_score must be between 0 and 100';
  end if;

  if tg_op = 'UPDATE' and old.quiz_passed_at is not null then
    new.quiz_passed_at := old.quiz_passed_at;
    new.quiz_score := old.quiz_score;
    return new;
  end if;

  if new.quiz_passed_at is not null and coalesce(new.quiz_score, 0) < 80 then
    new.quiz_passed_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists driver_knowledge_quiz_guard on public.driver_applications;
create trigger driver_knowledge_quiz_guard
  before insert or update on public.driver_applications
  for each row execute function public.guard_driver_knowledge_quiz();

create or replace function public.record_driver_knowledge_quiz(score integer)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  now_ts timestamptz := now();
  passed_at timestamptz;
  app public.driver_applications;
begin
  if uid is null then
    raise exception 'Sign in required';
  end if;
  if score is null or score < 0 or score > 100 then
    raise exception 'quiz_score must be between 0 and 100';
  end if;

  passed_at := case when score >= 80 then now_ts else null end;

  select * into app
  from public.driver_applications
  where profile_id = uid;

  if not found then
    insert into public.driver_applications (
      profile_id,
      is_student,
      has_car,
      has_insurance,
      wants_extra_money,
      onboarding_status,
      quiz_score,
      quiz_passed_at,
      quiz_attempted_at
    ) values (
      uid,
      false,
      false,
      false,
      false,
      'pending_info',
      score,
      passed_at,
      now_ts
    )
    returning * into app;
  elsif app.quiz_passed_at is null then
    update public.driver_applications
    set quiz_score = score,
        quiz_passed_at = passed_at,
        quiz_attempted_at = now_ts
    where profile_id = uid
    returning * into app;
  end if;

  return jsonb_build_object(
    'quiz_score', app.quiz_score,
    'quiz_passed_at', app.quiz_passed_at,
    'quiz_attempted_at', app.quiz_attempted_at,
    'onboarding_status', app.onboarding_status
  );
end;
$$;

revoke all on function public.record_driver_knowledge_quiz(integer) from public;
grant execute on function public.record_driver_knowledge_quiz(integer) to authenticated;
