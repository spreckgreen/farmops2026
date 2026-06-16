// Wraps `getMyProfile` in a TanStack Query so the layout, nav, and any
// component that needs to gate UI on role/approval status share one cached
// fetch. The query is created with `useServerFn` to ensure the auth bearer
// attacher fires.

import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyProfile, type MyProfile } from "@/lib/admin.functions";

export function useCurrentProfile() {
  const fetcher = useServerFn(getMyProfile);
  return useQuery<MyProfile>({
    queryKey: ["my-profile"],
    queryFn: () => fetcher(),
    staleTime: 60_000,
  });
}
