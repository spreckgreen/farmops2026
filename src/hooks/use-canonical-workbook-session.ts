import { useSyncExternalStore } from "react";
import {
  canonicalWorkbookAvailability,
  getCanonicalWorkbookSession,
  subscribeCanonicalWorkbookSession,
  type CanonicalWorkbookAvailability,
  type CanonicalWorkbookSession,
} from "@/lib/electrical-canonical-workbook-session";

/** Subscribe to the shared canonical-ODS session (bytes live in memory only). */
export function useCanonicalWorkbookSession(): {
  session: CanonicalWorkbookSession | null;
  availability: CanonicalWorkbookAvailability;
} {
  const session = useSyncExternalStore(
    subscribeCanonicalWorkbookSession,
    getCanonicalWorkbookSession,
    // Server render: the session is a browser-only concept.
    () => null,
  );
  return { session, availability: canonicalWorkbookAvailability(session) };
}
