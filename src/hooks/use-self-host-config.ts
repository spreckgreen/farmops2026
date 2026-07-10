import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getSelfHostConfig, type SelfHostConfig } from "@/lib/self-host.functions";

export function useSelfHostConfig() {
  const fn = useServerFn(getSelfHostConfig);
  return useQuery<SelfHostConfig>({
    queryKey: ["self-host-config"],
    queryFn: () => fn(),
    staleTime: 5 * 60 * 1000,
  });
}

/** Convenience: true iff no AI provider is wired up server-side. */
export function useAiUnavailable(): boolean {
  const q = useSelfHostConfig();
  return q.data?.aiProvider === "none";
}
