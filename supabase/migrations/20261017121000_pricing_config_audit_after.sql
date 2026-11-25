-- Fix-up for 20261017120000: audit with AFTER triggers so an
-- INSERT ... ON CONFLICT DO NOTHING that skips a row (for example re-running a
-- seed) writes no audit row. updated_at moves to its own BEFORE UPDATE trigger.
-- Additive / re-runnable.

CREATE OR REPLACE FUNCTION public.pricing_config_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (to_jsonb(OLD) - 'updated_at') IS DISTINCT FROM (to_jsonb(NEW) - 'updated_at') THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.pricing_config_audit_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old jsonb := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END;
  v_new jsonb := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END;
  v_row jsonb := coalesce(v_new, v_old);
  v_key text;
BEGIN
  IF TG_OP = 'UPDATE' AND (v_old - 'updated_at') = (v_new - 'updated_at') THEN
    RETURN NULL;
  END IF;
  v_key := coalesce(v_row->>'tier', v_row->>'game_date', v_row->>'id', '')
    || CASE WHEN v_row ? 'competitor' THEN ':' || (v_row->>'competitor') ELSE '' END;
  INSERT INTO public.pricing_config_audit (table_name, row_key, action, old_row, new_row, changed_by, change_reason)
  VALUES (TG_TABLE_NAME, v_key, TG_OP, v_old, v_new, v_row->>'updated_by', v_row->>'change_reason');
  RETURN NULL;
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pricing_rate_cards', 'pricing_settings', 'clemson_home_games', 'competitor_rate_cards'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_audit', t);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.pricing_config_audit_row()', t || '_audit', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_touch', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.pricing_config_touch_updated_at()', t || '_touch', t);
  END LOOP;
END
$$;

REVOKE EXECUTE ON FUNCTION public.pricing_config_audit_row() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pricing_config_touch_updated_at() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE EXECUTE ON FUNCTION public.pricing_config_touch_updated_at() FROM anon, authenticated;
  END IF;
END
$$;
