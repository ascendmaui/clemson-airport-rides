-- Align sign_driver_agreement with driver_approval_ready.
-- Older databases still sign ic-agreement-2026-09-24. Approval requires
-- the current version, ic-agreement-2026-10-05, so a signature never counted.
-- Additive. Replaces the function only. Does not rewrite signed rows.
-- Version 20261013230000.

create or replace function public.sign_driver_agreement(signature_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ver public.driver_agreement_versions;
  signed_name text;
  signed_at timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  signed_name := trim(coalesce(signature_name, ''));
  if length(signed_name) < 2 then
    raise exception 'Type your legal name to sign';
  end if;

  select * into ver
  from public.driver_agreement_versions
  where version = 'ic-agreement-2026-10-05';

  if ver.version is null then
    raise exception 'Agreement is not available';
  end if;

  insert into public.driver_agreements (
    profile_id,
    agreement_version,
    agreement_sha256,
    signature_name,
    signed_at,
    signer_user_id,
    html_snapshot
  )
  values (
    auth.uid(),
    ver.version,
    ver.sha256,
    signed_name,
    signed_at,
    auth.uid(),
    ver.body_html
  )
  on conflict (profile_id, agreement_version) do update
    set agreement_sha256 = excluded.agreement_sha256,
        signature_name = excluded.signature_name,
        signed_at = excluded.signed_at,
        signer_user_id = excluded.signer_user_id,
        html_snapshot = excluded.html_snapshot;

  return jsonb_build_object(
    'agreement_version', ver.version,
    'agreement_sha256', ver.sha256,
    'signature_name', signed_name,
    'signed_at', signed_at,
    'signer_user_id', auth.uid()
  );
end;
$$;

revoke all on function public.sign_driver_agreement(text) from public;
grant execute on function public.sign_driver_agreement(text) to authenticated;
