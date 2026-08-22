# ============================================================================
# idempotent-sql.awk — rewrite a migration file so every statement can be
# re-run safely, then re-run again, without erroring out.
#
# Used by scripts/apply-migrations.sh --fix-sql. Remediation scripts inline
# whole migration files, but part of a file may already be applied (the
# "PARTIAL" drift class). Without this pass the operator hits
#   ERROR:  relation "tasks" already exists
# halfway through and has to hand-comment statements. After this pass the
# script is fully re-runnable.
#
# Rewrites applied (case-insensitive):
#   CREATE TABLE/SCHEMA/SEQUENCE/INDEX/EXTENSION/MATERIALIZED VIEW
#                                     -> ... IF NOT EXISTS ...
#   CREATE [OR REPLACE] FUNCTION/PROCEDURE/VIEW/RULE
#                                     -> CREATE OR REPLACE ...
#   CREATE TRIGGER t ON tbl           -> DROP TRIGGER IF EXISTS t ON tbl; CREATE ...
#   CREATE POLICY p ON tbl            -> DROP POLICY IF EXISTS p ON tbl; CREATE ...
#   ALTER TABLE ... ADD COLUMN        -> ADD COLUMN IF NOT EXISTS
#   ALTER TABLE t ADD CONSTRAINT c    -> ALTER TABLE t DROP CONSTRAINT IF EXISTS c; ALTER ...
#   DROP <thing> x                    -> DROP <thing> IF EXISTS x
#   CREATE TYPE / DOMAIN / ROLE / PUBLICATION, and any other statement whose
#   only failure mode is "already exists", are wrapped in a DO block that
#   swallows duplicate_* / *_exists errors.
#   INSERT without ON CONFLICT gets a loud comment (can't be auto-fixed
#   safely — the operator decides).
#
# Statement splitting is quote-aware: single quotes (incl. ''), double-quoted
# identifiers, -- and /* */ comments, and $tag$ dollar-quoted function bodies
# are all respected, so a `;` inside a plpgsql body never splits a statement.
#
# Usage: awk -f scripts/lib/idempotent-sql.awk supabase/migrations/foo.sql
#        awk -v indent="  " -f ... foo.sql     # prefix every output line
# ============================================================================

BEGIN { src = ""; if (indent == "") indent = "" }
{ src = src $0 "\n" }

END { split_statements(src) }

function split_statements(s,   i, n, c, two, cur, state, tag, rest, j) {
  n = length(s); i = 1; cur = ""; state = ""
  while (i <= n) {
    c = substr(s, i, 1)
    if (state == "") {
      two = substr(s, i, 2)
      if (c == "'")  { state = "sq"; cur = cur c; i++; continue }
      if (c == "\"") { state = "dq"; cur = cur c; i++; continue }
      if (two == "--") {                                    # line comment
        j = index(substr(s, i), "\n")
        if (j == 0) { cur = cur substr(s, i); i = n + 1 }
        else        { cur = cur substr(s, i, j); i += j }
        continue
      }
      if (two == "/*") {                                    # block comment
        j = index(substr(s, i + 2), "*/")
        if (j == 0) { cur = cur substr(s, i); i = n + 1 }
        else        { cur = cur substr(s, i, j + 3); i += j + 3 }
        continue
      }
      if (c == "$") {                                       # dollar-quote open
        rest = substr(s, i)
        if (match(rest, /^\$[A-Za-z_0-9]*\$/)) {
          tag = substr(rest, 1, RLENGTH); cur = cur tag; i += RLENGTH; state = "dollar"
          continue
        }
        cur = cur c; i++; continue
      }
      if (c == ";") { emit(cur); cur = ""; i++; continue }
      cur = cur c; i++; continue
    }
    if (state == "sq") {
      if (c == "'") {
        if (substr(s, i, 2) == "''") { cur = cur "''"; i += 2; continue }
        state = ""
      }
      cur = cur c; i++; continue
    }
    if (state == "dq") { if (c == "\"") state = ""; cur = cur c; i++; continue }
    # dollar-quoted body
    if (substr(s, i, length(tag)) == tag) { cur = cur tag; i += length(tag); state = "" ; continue }
    cur = cur c; i++; continue
  }
  emit(cur)
}

function trim(x) { gsub(/^[ \t\r\n]+/, "", x); gsub(/[ \t\r\n]+$/, "", x); return x }

# Print text with the configured indent on every line.
function out(text,   k, m, lines) {
  m = split(text, lines, "\n")
  for (k = 1; k <= m; k++) {
    if (lines[k] == "" && k == m) continue
    print indent lines[k]
  }
}

# ---------------------------------------------------------------------------
# emit() — apply the idempotency rewrites to one statement and print it.
# `lc` is tolower(stmt); tolower preserves length, so RSTART/RLENGTH found in
# lc splice safely into the original text (keeping the author's formatting).
# ---------------------------------------------------------------------------
function emit(stmt,   body, lc, pos, name, tbl, pre, guard) {
  body = trim(stmt)
  if (body == "") return

  # A comment-only chunk (trailing comments after the last ;) — pass through.
  if (body ~ /^(--|\/\*)/ && strip_comments(body) == "") { out(body); print ""; return }

  lc = tolower(body)

  # ---- CREATE ... IF NOT EXISTS -------------------------------------------
  if (match(lc, /create[ \t\r\n]+table[ \t\r\n]+/) && RSTART == 1)
    body = insert_ine(body, lc, RSTART + RLENGTH)
  else if (match(lc, /create[ \t\r\n]+schema[ \t\r\n]+/) && RSTART == 1)
    body = insert_ine(body, lc, RSTART + RLENGTH)
  else if (match(lc, /create[ \t\r\n]+sequence[ \t\r\n]+/) && RSTART == 1)
    body = insert_ine(body, lc, RSTART + RLENGTH)
  else if (match(lc, /create[ \t\r\n]+extension[ \t\r\n]+/) && RSTART == 1)
    body = insert_ine(body, lc, RSTART + RLENGTH)
  else if (match(lc, /create[ \t\r\n]+materialized[ \t\r\n]+view[ \t\r\n]+/) && RSTART == 1)
    body = insert_ine(body, lc, RSTART + RLENGTH)
  else if (match(lc, /create([ \t\r\n]+unique)?[ \t\r\n]+index([ \t\r\n]+concurrently)?[ \t\r\n]+/) && RSTART == 1) {
    body = insert_ine(body, lc, RSTART + RLENGTH)
    # CREATE INDEX CONCURRENTLY cannot run inside the section's transaction
    # block, so drop the keyword — remediation indexes are small.
    lc = tolower(body)
    if (match(lc, /[ \t\r\n]concurrently[ \t\r\n]/))
      body = substr(body, 1, RSTART) substr(body, RSTART + RLENGTH - 1)
  }


  # ---- CREATE OR REPLACE (functions, views, rules) -------------------------
  else if (match(lc, /^create[ \t\r\n]+(function|procedure|view|rule)[ \t\r\n]/))
    body = substr(body, 1, 6) " or replace" substr(body, 7)

  # ---- CREATE TRIGGER / POLICY: drop-then-create ---------------------------
  else if (match(lc, /^create[ \t\r\n]+(or[ \t\r\n]+replace[ \t\r\n]+)?(constraint[ \t\r\n]+)?trigger[ \t\r\n]+/)) {
    pos = RSTART + RLENGTH
    name = next_ident(body, pos)
    tbl  = after_on(body, lc, pos)
    if (name != "" && tbl != "")
      pre = "DROP TRIGGER IF EXISTS " name " ON " tbl ";"
  }
  else if (match(lc, /^create[ \t\r\n]+policy[ \t\r\n]+/)) {
    pos = RSTART + RLENGTH
    name = next_ident(body, pos)
    tbl  = after_on(body, lc, pos)
    if (name != "" && tbl != "")
      pre = "DROP POLICY IF EXISTS " name " ON " tbl ";"
  }

  # ---- ALTER TABLE tweaks --------------------------------------------------
  else if (lc ~ /^alter[ \t\r\n]+table[ \t\r\n]/) {
    body = add_column_ine(body)
    lc = tolower(body)
    if (match(lc, /add[ \t\r\n]+constraint[ \t\r\n]+/)) {
      name = next_ident(body, RSTART + RLENGTH)
      tbl  = alter_target(body, lc)
      if (name != "" && tbl != "")
        pre = "ALTER TABLE " tbl " DROP CONSTRAINT IF EXISTS " name ";"
    }
  }

  # ---- DROP ... IF EXISTS --------------------------------------------------
  else if (match(lc, /^drop[ \t\r\n]+(table|type|domain|view|materialized[ \t\r\n]+view|index|sequence|trigger|policy|function|procedure|schema|publication|rule)[ \t\r\n]+/)) {
    if (substr(lc, RSTART + RLENGTH) !~ /^if[ \t\r\n]+exists/)
      body = substr(body, 1, RSTART + RLENGTH - 1) "IF EXISTS " substr(body, RSTART + RLENGTH)
  }

  # ---- Objects with no IF NOT EXISTS form: guard with a DO block -----------
  else if (lc ~ /^create[ \t\r\n]+(type|domain|role|user|publication|cast|operator|aggregate|collation)[ \t\r\n]/)
    guard = 1

  # ---- Non-idempotent data statements: warn, never silently change --------
  else if (lc ~ /^insert[ \t\r\n]+into/ && lc !~ /on[ \t\r\n]+conflict/)
    pre = "-- REVIEW: INSERT has no ON CONFLICT clause — re-running this file will"       \
          "\n-- duplicate these rows. Add ON CONFLICT DO NOTHING, or delete the"          \
          "\n-- statement if the rows are already present."

  if (pre != "") { out(pre); pre = "" }

  if (guard) {
    out("DO $idem$ BEGIN")
    out("  EXECUTE $idem_sql$" body "$idem_sql$;")
    out("EXCEPTION")
    out("  WHEN duplicate_object OR duplicate_table OR duplicate_column")
    out("    OR duplicate_function OR duplicate_schema OR unique_violation THEN")
    out("  RAISE NOTICE 'already present, skipping: %', substr($idem_sql$" body "$idem_sql$, 1, 60);")
    out("END $idem$;")
    print ""
    return
  }

  out(body ";")
  print ""
}

# Insert "if not exists " at character position `pos` unless it is already there.
function insert_ine(body, lc, pos) {
  if (substr(lc, pos) ~ /^if[ \t\r\n]+not[ \t\r\n]+exists/) return body
  return substr(body, 1, pos - 1) "IF NOT EXISTS " substr(body, pos)
}

# ADD COLUMN -> ADD COLUMN IF NOT EXISTS (handles several in one statement).
function add_column_ine(body,   lc, pos, at) {
  at = 1
  while (1) {
    lc = tolower(body)
    if (!match(substr(lc, at), /add[ \t\r\n]+column[ \t\r\n]+/)) break
    pos = at + RSTART + RLENGTH - 1
    if (substr(lc, pos) ~ /^if[ \t\r\n]+not[ \t\r\n]+exists/) { at = pos; continue }
    body = substr(body, 1, pos - 1) "IF NOT EXISTS " substr(body, pos)
    at = pos + 14
  }
  return body
}

# The next identifier at/after `pos` — bare, "quoted", or schema.qualified.
function next_ident(body, pos,   rest) {
  rest = substr(body, pos)
  sub(/^[ \t\r\n]+/, "", rest)
  if (match(rest, /^"[^"]+"([ \t\r\n]*\.[ \t\r\n]*"?[A-Za-z_0-9]+"?)?/)) return substr(rest, 1, RLENGTH)
  if (match(rest, /^[A-Za-z_][A-Za-z_0-9$]*([ \t\r\n]*\.[ \t\r\n]*"?[A-Za-z_][A-Za-z_0-9$]*"?)?/)) return substr(rest, 1, RLENGTH)
  return ""
}

# The table named after the next ` ON ` keyword (CREATE TRIGGER / POLICY).
function after_on(body, lc, pos,   sub_lc, hit) {
  sub_lc = substr(lc, pos)
  if (!match(sub_lc, /[ \t\r\n]on[ \t\r\n]+/)) return ""
  hit = pos + RSTART + RLENGTH - 1
  return next_ident(body, hit)
}

# The table named right after ALTER TABLE [IF EXISTS] [ONLY].
function alter_target(body, lc,   pos) {
  if (!match(lc, /^alter[ \t\r\n]+table[ \t\r\n]+(if[ \t\r\n]+exists[ \t\r\n]+)?(only[ \t\r\n]+)?/)) return ""
  pos = RSTART + RLENGTH
  return next_ident(body, pos)
}

# Rough comment stripper — only used to decide "is this chunk only comments?".
function strip_comments(x) {
  gsub(/--[^\n]*/, "", x)
  gsub(/\/\*([^*]|\*[^\/])*\*\//, "", x)
  return trim(x)
}
