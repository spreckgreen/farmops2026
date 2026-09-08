// Client-side view of the premium print package: planner sheets, label sheets,
// grid sheets, the map sheet, and publishing to Ghost and Obsidian. The server checks are
// actually protect the data (see @/lib/premium-print.server).
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { taskPrintAccess, type TaskPrintAccess } from "@/lib/task-print-access.functions";

export function usePremiumPrint() {
  const fn = useServerFn(taskPrintAccess);
  const q = useQuery<TaskPrintAccess>({
    queryKey: ["task-print-access"],
    queryFn: () => fn(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  return {
    isLoading: q.isLoading,
    allowed: Boolean(q.data?.allowed),
    isAdmin: Boolean(q.data?.isAdmin),
    granted: Boolean(q.data?.granted),
  };
}
