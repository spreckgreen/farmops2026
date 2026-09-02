// Change audit for the Electrical module.
//
// An electrician holding the field-write add-on may record what they actually
// installed, but the administrator has to be able to review that work later.
// Every field-record mutation therefore writes one row here describing who
// changed what, in which section, and the before/after value of each column.
//
// The audit write must never be able to fail a legitimate change: a broken
// audit insert is logged server-side and swallowed, because losing the audit
// trail for one edit is less harmful than rejecting an electrician's field
// record halfway through a save.

import { diffFieldChanges } from "@/lib/electrical-dependents";
import { FULL_ELECTRICAL_ADDON, FIELDWRITE_ELECTRICAL_ADDON } from "@/lib/addons";
import { hasAddon } from "@/lib/addons.server";
import type { ElectricalSection } from "@/lib/electrical-access";

type LooseDb = { from: (table: string) => any };

export const AUDIT_TABLE = "electrical_change_audit";

export type AuditAction = "create" | "update" | "delete";

export interface AuditFieldChange {
  column: string;
  before: string | null;
  after: string | null;
}

export interface RecordChangeInput {
  section: ElectricalSection | string;
  /** Entity kind or table-level label, e.g. "panel", "breaker_position". */
  entityKind: string;
  action: AuditAction;
  /** Row id, when known. */
  entityUuid?: string | null;
  /** Stable/human reference such as PNL-H1 or BR-104-02-05. */
  entityRef?: string | null;
  /** One-line human description shown in the admin review list. */
  summary?: string | null;
  /** Field-level before/after. Pass `before`/`patch` instead to have it diffed. */
  changes?: AuditFieldChange[];
  before?: Record<string, unknown> | null;
  patch?: Record<string, unknown> | null;
}

/** Which entitlement authorised this write, recorded alongside the change. */
async function accessBasis(supabase: unknown, userId: string): Promise<string> {
  try {
    if (await hasAddon(supabase, userId, FULL_ELECTRICAL_ADDON)) return FULL_ELECTRICAL_ADDON;
    if (await hasAddon(supabase, userId, FIELDWRITE_ELECTRICAL_ADDON)) {
      return FIELDWRITE_ELECTRICAL_ADDON;
    }
  } catch {
    /* fall through: the write already passed the gate */
  }
  return "unknown";
}

export async function recordElectricalChange(
  supabase: unknown,
  userId: string,
  input: RecordChangeInput,
): Promise<void> {
  try {
    const db = supabase as unknown as LooseDb;
    const changes =
      input.changes ??
      (input.patch
        ? diffFieldChanges(input.before ?? {}, input.patch).changes
        : []);

    const { data: profile } = await db
      .from("profiles")
      .select("email")
      .eq("id", userId)
      .maybeSingle();

    await db.from(AUDIT_TABLE).insert({
      user_id: userId,
      actor_email: (profile as { email?: string | null } | null)?.email ?? null,
      section: String(input.section),
      entity_kind: input.entityKind,
      entity_uuid: input.entityUuid ?? null,
      entity_ref: input.entityRef ?? null,
      action: input.action,
      summary: input.summary ?? null,
      changes,
      access_basis: await accessBasis(supabase, userId),
    });
  } catch (err) {
    console.error("[electrical-audit] could not record change", err);
  }
}
