-- One ledger row per trip and ambassador code. Additive; does not rewrite rows.
-- code is the ambassador identity. profile_id is nullable and is not written.

create unique index if not exists ambassador_payout_ledger_trip_code_uniq
  on public.ambassador_payout_ledger (trip_id, code);
