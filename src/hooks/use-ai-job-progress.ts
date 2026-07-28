import { useCallback, useEffect, useState } from "react";

const STORAGE_PREFIX = "farmops.ai-job.v1:";
const STALE_MS = 5 * 60 * 1000; // treat persisted starts older than 5 min as stale

type PersistedJob = { startedAt: number };

function read(surface: string): PersistedJob | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + surface);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedJob;
    if (
      !parsed ||
      typeof parsed.startedAt !== "number" ||
      Date.now() - parsed.startedAt > STALE_MS
    ) {
      window.localStorage.removeItem(STORAGE_PREFIX + surface);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Persist "an AI task is running" across page refreshes.
 *
 * - `start()` records `startedAt` in localStorage so a hard refresh can
 *   restore the progress panel with continuous elapsed time.
 * - `stop()` clears the record (call from mutation onSettled / cancel).
 * - `startedAt` is the persisted timestamp when a job is in flight, or
 *   `null` otherwise.
 * - `active` is true whenever a persisted job exists (whether it started
 *   in this tab or before the refresh).
 */
export function useAiJobProgress(surface: string) {
  const [startedAt, setStartedAt] = useState<number | null>(
    () => read(surface)?.startedAt ?? null,
  );

  // Re-hydrate after mount in case SSR returned null.
  useEffect(() => {
    const persisted = read(surface);
    if (persisted && persisted.startedAt !== startedAt) {
      setStartedAt(persisted.startedAt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surface]);

  // Cross-tab / cross-window sync.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_PREFIX + surface) return;
      const persisted = read(surface);
      setStartedAt(persisted?.startedAt ?? null);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [surface]);

  const start = useCallback(() => {
    const ts = Date.now();
    try {
      window.localStorage.setItem(
        STORAGE_PREFIX + surface,
        JSON.stringify({ startedAt: ts } satisfies PersistedJob),
      );
    } catch {
      // localStorage may be unavailable (private mode); still track in memory.
    }
    setStartedAt(ts);
    return ts;
  }, [surface]);

  const stop = useCallback(() => {
    try {
      window.localStorage.removeItem(STORAGE_PREFIX + surface);
    } catch {
      // ignore
    }
    setStartedAt(null);
  }, [surface]);

  return { startedAt, active: startedAt !== null, start, stop };
}
