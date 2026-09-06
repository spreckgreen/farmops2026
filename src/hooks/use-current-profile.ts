// Wraps `getMyProfile` in a TanStack Query so the layout, nav, and any
// component that needs to gate UI on role/approval status share one cached
// fetch. The query is created with `useServerFn` to ensure the auth bearer
// attacher fires.

import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useHasSession } from "@/hooks/use-has-session";
import { getMyProfile, type MyProfile } from "@/lib/admin.functions";

export function useCurrentProfile() {
  const fetcher = useServerFn(getMyProfile);
  const hasSession = useHasSession();
  return useQuery<MyProfile>({
    queryKey: ["my-profile"],
    queryFn: () => fetcher(),
    staleTime: 60_000,
    // Without a session there is no bearer token, so the server fn would throw
    // "Unauthorized: No authorization header provided" and blank the screen.
    enabled: hasSession === true,
    retry: false,
  });
}

