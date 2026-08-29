// Client-side add-on state for nav and route rendering. The server-side gate in
// @/lib/addons.server is what actually protects data.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyAddons, type MyAddon } from "@/lib/addons.functions";
import type { AddonKey } from "@/lib/addons";

export function useMyAddons() {
  const fetcher = useServerFn(getMyAddons);
  return useQuery<MyAddon[]>({
    queryKey: ["my-addons"],
    queryFn: () => fetcher(),
    staleTime: 60_000,
  });
}

export function useAddon(key: AddonKey) {
  const q = useMyAddons();
  const entry = (q.data ?? []).find((a) => a.key === key) ?? null;
  return {
    isLoading: q.isLoading,
    // A failed check must never be reported as "not entitled": that made every
    // gated page (including panel detail) look disabled after a token refresh.
    error: q.error as Error | null,
    refetch: q.refetch,
    enabled: Boolean(entry?.enabled),
    status: entry?.status ?? null,
    expiresAt: entry?.expires_at ?? null,
  };
}
