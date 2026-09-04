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
