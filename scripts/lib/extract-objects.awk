# ============================================================================
# extract-objects.awk — list the database objects a migration file creates.
#
# Used by scripts/apply-migrations.sh --adopt to decide whether a migration is
# already present in a hand-built database, without executing it.
#
# Input : one supabase/migrations/*.sql file on stdin (or as a file argument)
# Output: one object per line, pipe-delimited:
#
#   table|public|inventory_items
#   column|public|daily_notes|energy_level
#   type|public|app_role
#   function|public|has_role
#   policy|public|tasks|Users can view their own tasks
#   trigger|public|tasks|tasks_set_updated_at
#   index|public|idx_tasks_user_id
#
# Deliberately conservative: it only recognises the statement shapes this repo
# actually uses. Anything it can't parse is simply not emitted, which makes the
# migration look "not fully present" and therefore stay pending — the safe
# direction to fail in.
# ============================================================================

function strip(s) {
  gsub(/^[ \t"`]+/, "", s)
  gsub(/[ \t"`;,()]+$/, "", s)
  return s
}

# Split an optionally schema-qualified identifier into SCHEMA / NAME.
# "public.tasks" -> schema=public name=tasks ; "tasks" -> schema=public
function qualify(ident,   n, parts) {
  ident = strip(ident)
  gsub(/"/, "", ident)
  n = split(ident, parts, ".")
  if (n >= 2) { OSCHEMA = parts[n - 1]; ONAME = parts[n] }
  else        { OSCHEMA = "public";     ONAME = parts[1] }
  return ONAME != ""
}

function emit(kind, schema, name, extra) {
  if (name == "") return
  key = kind "|" schema "|" name "|" extra
  if (key in seen) return
  seen[key] = 1
  if (extra == "") print kind "|" schema "|" name
  else             print kind "|" schema "|" name "|" extra
}

{
  line = $0
  sub(/--.*$/, "", line)          # drop line comments
  lower = tolower(line)
}

# ---- CREATE TABLE [IF NOT EXISTS] <ident> -----------------------------------
lower ~ /create[ \t]+table/ {
  ident = line
  sub(/^.*[Cc][Rr][Ee][Aa][Tt][Ee][ \t]+[Tt][Aa][Bb][Ll][Ee][ \t]+/, "", ident)
  sub(/^[Ii][Ff][ \t]+[Nn][Oo][Tt][ \t]+[Ee][Xx][Ii][Ss][Tt][Ss][ \t]+/, "", ident)
  sub(/[ \t(].*$/, "", ident)
  if (qualify(ident)) emit("table", OSCHEMA, ONAME, "")
}

# ---- CREATE TYPE <ident> ----------------------------------------------------
lower ~ /create[ \t]+type/ {
  ident = line
  sub(/^.*[Cc][Rr][Ee][Aa][Tt][Ee][ \t]+[Tt][Yy][Pp][Ee][ \t]+/, "", ident)
  sub(/[ \t(].*$/, "", ident)
  if (qualify(ident)) emit("type", OSCHEMA, ONAME, "")
}

# ---- CREATE [OR REPLACE] FUNCTION <ident>( ---------------------------------
# CREATE OR REPLACE is idempotent, so a present function is a strong signal the
# file ran, and a missing one correctly keeps the file pending.
lower ~ /create[ \t]+(or[ \t]+replace[ \t]+)?function/ {
  ident = line
  sub(/^.*[Ff][Uu][Nn][Cc][Tt][Ii][Oo][Nn][ \t]+/, "", ident)
  sub(/[ \t(].*$/, "", ident)
  if (qualify(ident)) emit("function", OSCHEMA, ONAME, "")
}

# ---- CREATE [UNIQUE] INDEX [IF NOT EXISTS] <name> ON <table> ---------------
lower ~ /create[ \t]+(unique[ \t]+)?index/ {
  ident = line
  sub(/^.*[Ii][Nn][Dd][Ee][Xx][ \t]+/, "", ident)
  sub(/^[Ii][Ff][ \t]+[Nn][Oo][Tt][ \t]+[Ee][Xx][Ii][Ss][Tt][Ss][ \t]+/, "", ident)
  sub(/[ \t(].*$/, "", ident)
  if (qualify(ident)) emit("index", OSCHEMA, ONAME, "")
}

# ---- CREATE POLICY "<name>" ON <table> -------------------------------------
lower ~ /create[ \t]+policy/ {
  rest = line
  sub(/^.*[Pp][Oo][Ll][Ii][Cc][Yy][ \t]+/, "", rest)
  pname = ""
  if (substr(rest, 1, 1) == "\"") {
    close_q = index(substr(rest, 2), "\"")
    if (close_q > 0) { pname = substr(rest, 2, close_q - 1); rest = substr(rest, close_q + 2) }
  } else {
    split(rest, w, /[ \t]+/); pname = w[1]
    sub(/^[^ \t]+/, "", rest)
  }
  # table may live on this line ("... ON public.tasks") or the next one
  if (match(tolower(rest), /[ \t]on[ \t]+/)) {
    tbl = substr(rest, RSTART + RLENGTH)
    sub(/[ \t(].*$/, "", tbl)
    if (qualify(tbl)) emit("policy", OSCHEMA, ONAME, pname)
  } else {
    pending_policy = pname
  }
  next
}
pending_policy != "" && match(lower, /^[ \t]*on[ \t]+/) {
  tbl = substr(line, RSTART + RLENGTH)
  sub(/[ \t(].*$/, "", tbl)
  if (qualify(tbl)) emit("policy", OSCHEMA, ONAME, pending_policy)
  pending_policy = ""
  next
}

# ---- CREATE TRIGGER <name> ... ON <table> ----------------------------------
lower ~ /create[ \t]+trigger/ {
  rest = line
  sub(/^.*[Tt][Rr][Ii][Gg][Gg][Ee][Rr][ \t]+/, "", rest)
  split(rest, w, /[ \t]+/)
  tname = strip(w[1])
  if (match(tolower(rest), /[ \t]on[ \t]+/)) {
    tbl = substr(rest, RSTART + RLENGTH)
    sub(/[ \t(].*$/, "", tbl)
    if (qualify(tbl)) emit("trigger", OSCHEMA, ONAME, tname)
  } else {
    pending_trigger = tname
  }
  next
}
pending_trigger != "" && match(lower, /^[ \t]*on[ \t]+/) {
  tbl = substr(line, RSTART + RLENGTH)
  sub(/[ \t(].*$/, "", tbl)
  if (qualify(tbl)) emit("trigger", OSCHEMA, ONAME, pending_trigger)
  pending_trigger = ""
  next
}

# ---- ALTER TABLE <ident> ... ADD COLUMN [IF NOT EXISTS] <col> --------------
# ALTER TABLE frequently spans lines with several ADD COLUMN clauses, so the
# current table is remembered until the statement terminator.
lower ~ /alter[ \t]+table/ {
  ident = line
  sub(/^.*[Aa][Ll][Tt][Ee][Rr][ \t]+[Tt][Aa][Bb][Ll][Ee][ \t]+/, "", ident)
  sub(/^[Ii][Ff][ \t]+[Ee][Xx][Ii][Ss][Tt][Ss][ \t]+/, "", ident)
  sub(/^[Oo][Nn][Ll][Yy][ \t]+/, "", ident)
  sub(/[ \t(].*$/, "", ident)
  if (qualify(ident)) { cur_schema = OSCHEMA; cur_table = ONAME }
}

cur_table != "" {
  work = line
  while (match(tolower(work), /add[ \t]+column[ \t]+/)) {
    col = substr(work, RSTART + RLENGTH)
    work = col
    sub(/^[Ii][Ff][ \t]+[Nn][Oo][Tt][ \t]+[Ee][Xx][Ii][Ss][Tt][Ss][ \t]+/, "", col)
    split(col, cw, /[ \t]+/)
    cname = strip(cw[1])
    if (cname ~ /^[A-Za-z_][A-Za-z0-9_]*$/) emit("column", cur_schema, cur_table, cname)
  }
  if (line ~ /;/) { cur_table = ""; cur_schema = "" }
}
