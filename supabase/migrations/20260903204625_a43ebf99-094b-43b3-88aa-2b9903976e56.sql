-- 1. Scope shared electrical read/write helpers to the calling user and to
--    genuinely active, non-locked-out grants only.
CREATE OR REPLACE FUNCTION private.has_electrical_read(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select _user_id is not null
     and _user_id = auth.uid()
     and exists (
    select 1 from public.app_entitlements e
    where e.user_id = _user_id
      and e.addon_key in ('electrical','electrical_fieldwrite','electrical_readonly')
      and e.status = 'active'
      and (e.expires_at is null or e.expires_at > now())
      and (e.blocked_until is null or e.blocked_until <= now())
  )
$function$;

CREATE OR REPLACE FUNCTION private.has_electrical_field_write(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select _user_id is not null
     and _user_id = auth.uid()
     and exists (
    select 1 from public.app_entitlements e
    where e.user_id = _user_id
      and e.addon_key in ('electrical','electrical_fieldwrite')
      and e.status = 'active'
      and (e.expires_at is null or e.expires_at > now())
      and (e.blocked_until is null or e.blocked_until <= now())
  )
$function$;

-- 2. Defence in depth for the approval workflows: a requester may never move
--    their own request out of 'pending' or set decision fields.
CREATE OR REPLACE FUNCTION public.electrical_guard_request_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private'
AS $function$
BEGIN
  IF private.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Only an administrator may change the approval status.';
  END IF;
  IF to_jsonb(NEW) ? 'decided_by'
     AND (to_jsonb(NEW)->>'decided_by') IS DISTINCT FROM (to_jsonb(OLD)->>'decided_by') THEN
    RAISE EXCEPTION 'Only an administrator may record an approval decision.';
  END IF;
  IF to_jsonb(NEW) ? 'decided_at'
     AND (to_jsonb(NEW)->>'decided_at') IS DISTINCT FROM (to_jsonb(OLD)->>'decided_at') THEN
    RAISE EXCEPTION 'Only an administrator may record an approval decision.';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS electrical_nameplate_requests_guard_decision
  ON public.electrical_nameplate_write_requests;
CREATE TRIGGER electrical_nameplate_requests_guard_decision
  BEFORE UPDATE ON public.electrical_nameplate_write_requests
  FOR EACH ROW EXECUTE FUNCTION public.electrical_guard_request_decision();

DROP TRIGGER IF EXISTS electrical_panel_edit_requests_guard_decision
  ON public.electrical_panel_edit_requests;
CREATE TRIGGER electrical_panel_edit_requests_guard_decision
  BEFORE UPDATE ON public.electrical_panel_edit_requests
  FOR EACH ROW EXECUTE FUNCTION public.electrical_guard_request_decision();