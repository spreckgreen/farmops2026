// Client-side view of the account's subscription tier. Display only — the
// server re-checks every entitlement before any gated data is returned.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMySubscription, type MySubscription } from "@/lib/subscriptions.functions";

export function useMySubscription() {
  const fetcher = useServerFn(getMySubscription);
  return useQuery<MySubscription | null>({
    queryKey: ["my-subscription"],
    queryFn: () => fetcher(),
    staleTime: 60_000,
  });
}

/** True when the account's plan currently unlocks this module. */
export function useModuleUnlocked(moduleKey: string) {
  const q = useMySubscription();
  return {
    isLoading: q.isLoading,
    error: q.error as Error | null,
    unlocked: Boolean(q.data?.unlocked.includes(moduleKey)),
    subscription: q.data ?? null,
  };
}
