-- Encrypted driver W-9. Additive. Does not drop driver_tax_info or driver_tax_secrets.
-- The full TIN is stored only as ciphertext. Authenticated drivers can write
-- their own row and can read every column except tin_ciphertext. Service role
-- can read the ciphertext. Admins decrypt through admin_read_driver_w9_tin.
-- The encryption key is vault secret driver_w9_tin_key, or the database
-- setting app.driver_w9_tin_key when vault is not installed. It is never returned.

create extension if not exists pgcrypto;

create table if not exists public.driver_w9 (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  legal_name text not null,
  business_name text,
  tax_classification text not null,
  address_line text not null,
  tin_last4 text,
  tin_kind text,
  tin_ciphertext bytea,
  certified boolean not null default false,
  signature_name text,
  signed_on date,
  collection text not null default 'app',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint driver_w9_last4_check check (tin_last4 is null or tin_last4 ~ '^[0-9]{4}$'),
  constraint driver_w9_kind_check check (tin_kind is null or tin_kind in ('ssn', 'ein')),
  constraint driver_w9_class_check check (tax_classification in ('individual', 'llc', 'c_corp', 's_corp', 'partnership', 'other')),
  constraint driver_w9_collection_check check (collection in ('app', 'stripe')),
  constraint driver_w9_ciphertext_check check (
    (collection = 'stripe' and tin_ciphertext is null)
    or (collection = 'app' and tin_ciphertext is not null)
  )
);

comment on column public.driver_w9.tin_ciphertext is
  'pgp_sym_encrypt of the 9-digit TIN. No plaintext TIN column. Drivers cannot select this column.';

alter table public.driver_w9 enable row level security;

drop policy if exists driver_w9_owner_select on public.driver_w9;
create policy driver_w9_owner_select
  on public.driver_w9
  for select
  to authenticated
  using (profile_id = auth.uid() or public.is_admin());

drop policy if exists driver_w9_owner_insert on public.driver_w9;
create policy driver_w9_owner_insert
  on public.driver_w9
  for insert
  to authenticated
  with check (profile_id = auth.uid());

drop policy if exists driver_w9_owner_update on public.driver_w9;
create policy driver_w9_owner_update
  on public.driver_w9
  for update
  to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

revoke all on table public.driver_w9 from public, anon, authenticated;

grant select (
  profile_id,
  legal_name,
  business_name,
  tax_classification,
  address_line,
  tin_last4,
  tin_kind,
  certified,
  signature_name,
  signed_on,
  collection,
  created_at,
  updated_at
) on table public.driver_w9 to authenticated;

grant insert (
  profile_id,
  legal_name,
  business_name,
  tax_classification,
  address_line,
  tin_last4,
  tin_kind,
  tin_ciphertext,
  certified,
  signature_name,
  signed_on,
  collection,
  created_at,
  updated_at
), update (
  legal_name,
  business_name,
  tax_classification,
  address_line,
  tin_last4,
  tin_kind,
  tin_ciphertext,
  certified,
  signature_name,
  signed_on,
  collection,
  updated_at
) on table public.driver_w9 to authenticated;

grant all on table public.driver_w9 to service_role;

create or replace function public.touch_driver_w9()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' and new.created_at is null then
    new.created_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists driver_w9_touch on public.driver_w9;
create trigger driver_w9_touch
  before insert or update on public.driver_w9
  for each row execute function public.touch_driver_w9();

create or replace function public.driver_w9_encryption_key()
returns text
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  secret text;
begin
  begin
    select decrypted_secret into secret
    from vault.decrypted_secrets
    where name = 'driver_w9_tin_key'
    limit 1;
  exception
    when others then
      secret := null;
  end;
  if secret is null or length(secret) < 16 then
    secret := nullif(current_setting('app.driver_w9_tin_key', true), '');
  end if;
  if secret is null or length(secret) < 16 then
    raise exception 'W-9 encryption key is not configured';
  end if;
  return secret;
end;
$$;

revoke all on function public.driver_w9_encryption_key() from public, anon, authenticated;
grant execute on function public.driver_w9_encryption_key() to service_role;

create or replace function public.save_driver_w9_record(
  legal_name text,
  business_name text,
  tax_classification text,
  address_line text,
  tin text,
  tin_kind text,
  certified boolean,
  signature_name text,
  signed_on date
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  digits text;
  last4 text;
  cleaned_name text;
  cleaned_business text;
  cleaned_address text;
  cleaned_signature text;
  area int;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  if certified is distinct from true then
    raise exception 'Certification is required';
  end if;
  cleaned_name := trim(coalesce(legal_name, ''));
  if length(cleaned_name) < 2 then
    raise exception 'Legal name is required';
  end if;
  cleaned_business := nullif(trim(coalesce(business_name, '')), '');
  cleaned_address := trim(coalesce(address_line, ''));
  if length(cleaned_address) < 5 then
    raise exception 'Address is required';
  end if;
  if tax_classification not in ('individual', 'llc', 'c_corp', 's_corp', 'partnership', 'other') then
    raise exception 'Choose a tax classification';
  end if;
  if tin_kind not in ('ssn', 'ein') then
    raise exception 'Choose SSN or EIN';
  end if;
  digits := regexp_replace(coalesce(tin, ''), '[^0-9]', '', 'g');
  if digits !~ '^[0-9]{9}$' then
    raise exception 'TIN must be 9 digits';
  end if;
  if tin_kind = 'ssn' then
    area := substr(digits, 1, 3)::int;
    if area = 0 or area = 666 or area >= 900 or substr(digits, 4, 2) = '00' or substr(digits, 6, 4) = '0000' then
      raise exception 'Enter a valid SSN';
    end if;
  elsif substr(digits, 1, 2) = '00' or substr(digits, 3, 7) = '0000000' then
    raise exception 'Enter a valid EIN';
  end if;
  cleaned_signature := trim(coalesce(signature_name, ''));
  if length(cleaned_signature) < 2 then
    raise exception 'Type your legal name to sign';
  end if;
  if signed_on is null then
    raise exception 'Date is required';
  end if;
  last4 := right(digits, 4);

  insert into public.driver_w9 (
    profile_id,
    legal_name,
    business_name,
    tax_classification,
    address_line,
    tin_last4,
    tin_kind,
    tin_ciphertext,
    certified,
    signature_name,
    signed_on,
    collection,
    created_at,
    updated_at
  )
  values (
    auth.uid(),
    cleaned_name,
    cleaned_business,
    tax_classification,
    cleaned_address,
    last4,
    tin_kind,
    pgp_sym_encrypt(digits, public.driver_w9_encryption_key()),
    true,
    cleaned_signature,
    signed_on,
    'app',
    now(),
    now()
  )
  on conflict (profile_id) do update
    set legal_name = excluded.legal_name,
        business_name = excluded.business_name,
        tax_classification = excluded.tax_classification,
        address_line = excluded.address_line,
        tin_last4 = excluded.tin_last4,
        tin_kind = excluded.tin_kind,
        tin_ciphertext = excluded.tin_ciphertext,
        certified = true,
        signature_name = excluded.signature_name,
        signed_on = excluded.signed_on,
        collection = 'app',
        updated_at = now();

  if to_regclass('public.driver_tax_info') is not null then
    insert into public.driver_tax_info (profile_id, legal_name, tin_last4, tax_classification, updated_at)
    values (auth.uid(), cleaned_name, last4, tax_classification, now())
    on conflict (profile_id) do update
      set legal_name = excluded.legal_name,
          tin_last4 = excluded.tin_last4,
          tax_classification = excluded.tax_classification,
          updated_at = now();
    update public.driver_tax_info
      set business_name = cleaned_business,
          address_line = cleaned_address
      where profile_id = auth.uid();
  end if;

  return jsonb_build_object(
    'legal_name', cleaned_name,
    'business_name', cleaned_business,
    'tax_classification', tax_classification,
    'address_line', cleaned_address,
    'tin_last4', last4,
    'tin_kind', tin_kind,
    'certified', true,
    'signature_name', cleaned_signature,
    'signed_on', signed_on,
    'collection', 'app'
  );
end;
$$;

revoke all on function public.save_driver_w9_record(text, text, text, text, text, text, boolean, text, date) from public, anon;
grant execute on function public.save_driver_w9_record(text, text, text, text, text, text, boolean, text, date) to authenticated;

create or replace function public.admin_read_driver_w9_tin(target uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  cipher bytea;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' and not public.is_admin() then
    raise exception 'Not allowed';
  end if;
  select tin_ciphertext into cipher
  from public.driver_w9
  where profile_id = target;
  if cipher is null then
    return null;
  end if;
  return pgp_sym_decrypt(cipher, public.driver_w9_encryption_key());
end;
$$;

revoke all on function public.admin_read_driver_w9_tin(uuid) from public, anon;
grant execute on function public.admin_read_driver_w9_tin(uuid) to authenticated, service_role;
