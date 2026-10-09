-- Optional rating tags (driver rates rider: "On time", "Wrong pickup spot", ...).
-- Additive: older app builds keep inserting without tags and get the empty default.
alter table public.ratings add column if not exists tags text[] not null default '{}';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.ratings'::regclass and conname = 'ratings_tags_limit'
  ) then
    alter table public.ratings
      add constraint ratings_tags_limit
      check (cardinality(tags) <= 5 and char_length(array_to_string(tags, '')) <= 200);
  end if;
end
$$;

comment on column public.ratings.tags is 'Up to 5 short tags chosen with the star rating.';
