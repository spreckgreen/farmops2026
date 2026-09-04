// Account-level UI preference flags. The value lives in the signed-in user's
// profile preferences (so it follows them across browsers and devices), with
// localStorage kept in sync purely as an offline/first-paint fallback.
import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getMyUiPreferences,
  setMyUiPreference,
  type UiPreferences,
} from "@/lib/ui-preferences.functions";

const QUERY_KEY = ["my-ui-preferences"] as const;

export function useUiPreferences() {
  const fetcher = useServerFn(getMyUiPreferences);
  return useQuery<UiPreferences>({
    queryKey: QUERY_KEY,
    queryFn: () => fetcher(),
    staleTime: 60_000,
    retry: false,
  });
}

function readLocal(key: string): boolean | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    // storage unavailable
  }
  return null;
}

/**
 * Remembered on/off choice for the current account.
 * `localKey` is the legacy localStorage key, used for first paint and as the
 * fallback when the account preference has not been saved yet.
 */
export function useUiFlag(
  prefKey: string,
  localKey: string,
  defaultOn = false,
): [boolean, (next: boolean) => void] {
  const [on, setOn] = useState(defaultOn);
  const prefs = useUiPreferences();
  const queryClient = useQueryClient();
  const saver = useServerFn(setMyUiPreference);
  const save = useMutation({
    mutationFn: (value: boolean) => saver({ data: { key: prefKey, value } }),
    onSuccess: (data) => queryClient.setQueryData(QUERY_KEY, data),
  });

  // First paint: local copy so the map does not flicker while the account
  // preference loads.
  useEffect(() => {
    const local = readLocal(localKey);
    if (local !== null) setOn(local);
  }, [localKey]);

  // Account preference wins once it arrives.
  useEffect(() => {
    if (!prefs.data) return;
    const remote = prefs.data[prefKey];
    if (typeof remote === "boolean") {
      setOn(remote);
      try {
        window.localStorage.setItem(localKey, remote ? "1" : "0");
      } catch {
        // ignore
      }
    }
  }, [prefs.data, prefKey, localKey]);

  const apply = useCallback(
    (next: boolean) => {
      setOn(next);
      try {
        window.localStorage.setItem(localKey, next ? "1" : "0");
      } catch {
        // ignore
      }
      save.mutate(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [localKey, prefKey],
  );

  return [on, apply];
}

/**
 * Remembered multiple-choice selection for the current account (for example the
 * grid map's base overlay or progress mode). Same storage as `useUiFlag`:
 * profile preferences, with localStorage as the first-paint fallback.
 * `allowed` guards against stale or unknown stored values.
 */
export function useUiChoice<T extends string>(
  prefKey: string,
  localKey: string,
  allowed: readonly T[],
  defaultValue: T,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(defaultValue);
  const prefs = useUiPreferences();
  const queryClient = useQueryClient();
  const saver = useServerFn(setMyUiPreference);
  const save = useMutation({
    mutationFn: (next: T) => saver({ data: { key: prefKey, value: next } }),
    onSuccess: (data) => queryClient.setQueryData(QUERY_KEY, data),
  });

  const isAllowed = useCallback(
    (v: unknown): v is T => typeof v === "string" && (allowed as readonly string[]).includes(v),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allowed.join("|")],
  );

  useEffect(() => {
    try {
      const local = window.localStorage.getItem(localKey);
      if (isAllowed(local)) setValue(local);
    } catch {
      // storage unavailable
    }
  }, [localKey, isAllowed]);

  useEffect(() => {
    if (!prefs.data) return;
    const remote = prefs.data[prefKey];
    if (isAllowed(remote)) {
      setValue(remote);
      try {
        window.localStorage.setItem(localKey, remote);
      } catch {
        // ignore
      }
    }
  }, [prefs.data, prefKey, localKey, isAllowed]);

  const apply = useCallback(
    (next: T) => {
      if (!isAllowed(next)) return;
      setValue(next);
      try {
        window.localStorage.setItem(localKey, next);
      } catch {
        // ignore
      }
      save.mutate(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [localKey, prefKey, isAllowed],
  );

  return [value, apply];
}

