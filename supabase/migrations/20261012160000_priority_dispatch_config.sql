-- Top-rated priority dispatch config (admin-editable). Additive.
insert into public.driver_perk_config (key, value)
values ('priority_dispatch', jsonb_build_object('enabled', true, 'minRating', 4.9, 'minRatingCount', 5, 'minTrips', 25, 'boost', 1))
on conflict (key) do nothing;
