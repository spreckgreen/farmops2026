-- RLS test: simulate viewer vs editor and report blocked/allowed writes.
-- Usage: psql -f scripts/test-rls.sql
--
-- Creates two ephemeral test users in auth.users + profiles + user_roles,
-- runs INSERT/UPDATE/DELETE against public.tasks as each, and prints PASS/FAIL.
-- Rolls back everything at the end — no data persists.

\set ON_ERROR_STOP 0
\pset format aligned
BEGIN;

-- ---------- Setup test users ----------
DO $$
DECLARE
  v_viewer uuid := '00000000-0000-0000-0000-00000000aaaa';
  v_editor uuid := '00000000-0000-0000-0000-00000000bbbb';
BEGIN
  INSERT INTO auth.users (id, email, instance_id, aud, role)
  VALUES
    (v_viewer, 'viewer@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (v_editor, 'editor@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, email, status)
  VALUES (v_viewer, 'viewer@test.local', 'approved'),
         (v_editor, 'editor@test.local', 'approved')
  ON CONFLICT (id) DO UPDATE SET status='approved';

  INSERT INTO public.user_roles (user_id, role) VALUES
    (v_viewer, 'viewer'),
    (v_editor, 'editor')
  ON CONFLICT (user_id, role) DO NOTHING;
END $$;

-- Helper: become a user (set authenticated role + JWT claim auth.uid())
\set viewer_id '00000000-0000-0000-0000-00000000aaaa'
\set editor_id '00000000-0000-0000-0000-00000000bbbb'

-- Results table
CREATE TEMP TABLE rls_results (
  actor text, op text, expected text, actual text, pass boolean
) ON COMMIT DROP;

-- Reusable helper to run a statement as a given user and record result
CREATE OR REPLACE FUNCTION pg_temp.try_as(
  _user uuid, _actor text, _op text, _expected text, _sql text
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_actual text := 'allowed';
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _user, 'role','authenticated')::text, true);
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN
    v_actual := 'blocked';
  END;
  PERFORM set_config('role', 'postgres', true);
  INSERT INTO rls_results VALUES (_actor, _op, _expected, v_actual, v_actual = _expected);
END $$;

-- Seed a task owned by viewer & one by editor (as postgres, bypassing RLS)
INSERT INTO public.tasks (id, user_id, title, slug, status)
VALUES
  ('00000000-0000-0000-0000-0000000000a1', :'viewer_id'::uuid, 'viewer-seed', 'viewer-seed', 'open'),
  ('00000000-0000-0000-0000-0000000000b1', :'editor_id'::uuid, 'editor-seed', 'editor-seed', 'open');

-- ---------- Viewer (should be blocked on writes, allowed on reads) ----------
SELECT pg_temp.try_as(:'viewer_id'::uuid, 'viewer', 'SELECT own',  'allowed',
  'PERFORM 1 FROM public.tasks WHERE user_id = '''||:'viewer_id'||'''');
SELECT pg_temp.try_as(:'viewer_id'::uuid, 'viewer', 'INSERT',     'blocked',
  'INSERT INTO public.tasks (user_id,title,slug,status) VALUES ('''||:'viewer_id'||''',''v-new'',''v-new-'||extract(epoch from now())::bigint||''',''open'')');
SELECT pg_temp.try_as(:'viewer_id'::uuid, 'viewer', 'UPDATE own', 'blocked',
  'UPDATE public.tasks SET title=''hacked'' WHERE user_id = '''||:'viewer_id'||'''');
SELECT pg_temp.try_as(:'viewer_id'::uuid, 'viewer', 'DELETE own', 'blocked',
  'DELETE FROM public.tasks WHERE user_id = '''||:'viewer_id'||'''');

-- ---------- Editor (should be allowed on own rows, blocked on others) ----------
SELECT pg_temp.try_as(:'editor_id'::uuid, 'editor', 'INSERT',     'allowed',
  'INSERT INTO public.tasks (user_id,title,slug,status) VALUES ('''||:'editor_id'||''',''e-new'',''e-new-'||extract(epoch from now())::bigint||''',''open'')');
SELECT pg_temp.try_as(:'editor_id'::uuid, 'editor', 'UPDATE own', 'allowed',
  'UPDATE public.tasks SET title=''edited'' WHERE user_id = '''||:'editor_id'||'''');
SELECT pg_temp.try_as(:'editor_id'::uuid, 'editor', 'UPDATE other','blocked',
  'UPDATE public.tasks SET title=''stolen'' WHERE user_id = '''||:'viewer_id'||'''');
SELECT pg_temp.try_as(:'editor_id'::uuid, 'editor', 'DELETE own', 'allowed',
  'DELETE FROM public.tasks WHERE user_id = '''||:'editor_id'||'''');

-- ---------- Report ----------
SELECT
  actor, op, expected, actual,
  CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS result
FROM rls_results
ORDER BY actor, op;

SELECT
  count(*) FILTER (WHERE pass) AS passed,
  count(*) FILTER (WHERE NOT pass) AS failed,
  count(*) AS total
FROM rls_results;

ROLLBACK;
