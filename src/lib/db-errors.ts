/**
 * Translate raw Postgres/PostgREST errors into messages a farm user can act on.
 *
 * The most common one in practice is an RLS insert rejection: an approved user
 * still holds the read-only `viewer` role, so `private.can_write()` is false and
 * Postgres answers `new row violates row-level security policy for table
 * "tasks"`. That string is meaningless to the person clicking Save.
 */
export interface DbErrorLike {
  message?: string | null;
  code?: string | null;
  details?: string | null;
}

const READ_ONLY_MESSAGE =
  "Your account has read-only (viewer) access, so this change can't be saved. Ask a Bostead Farms admin to grant you the editor role.";

/** True when the error is a permission/RLS rejection rather than bad data. */
export function isPermissionError(error: DbErrorLike | null | undefined): boolean {
  if (!error) return false;
  const msg = (error.message ?? "").toLowerCase();
  return (
    error.code === "42501" ||
    msg.includes("row-level security") ||
    msg.includes("permission denied")
  );
}

/** Error to throw from a server function for a failed database write. */
export function dbError(error: DbErrorLike | null | undefined, fallback = "Database error"): Error {
  if (isPermissionError(error)) return new Error(READ_ONLY_MESSAGE);
  return new Error(error?.message || fallback);
}
