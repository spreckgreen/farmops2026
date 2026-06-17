import { useCallback, useEffect, useState } from "react";

/**
 * Debug toggle: show or hide `#task-slug` lines under task titles across
 * `/tasks` (Today), `/tasks/backlog`, and `/tasks/scheduled`.
 *
 * Persisted in localStorage so the choice survives reloads. Off by default —
 * slugs are noise for daily reading and are only useful when debugging
 * activity-log ↔ markdown linkage.
 */
const KEY = "bostead.showTaskSlugs";

function read(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function useShowTaskSlugs(): [boolean, () => void] {
  const [show, setShow] = useState<boolean>(false);

  useEffect(() => {
    setShow(read());
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setShow(e.newValue === "1");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const toggle = useCallback(() => {
    setShow((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return [show, toggle];
}
