import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { BookOpen, Link2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { listKitProcedureSuggestions, type KitSuggestionResult } from "@/lib/kit-procedures.functions";
import { createProcedureLink } from "@/lib/procedure-links.functions";

/** Auto-suggested kit manuals/SOPs with one-click attach. */
export function KitProcedureSuggestions({ kitItemId }: { kitItemId: string }) {
  const qc = useQueryClient();
  const suggestFn = useServerFn(listKitProcedureSuggestions);
  const linkFn = useServerFn(createProcedureLink);

  const key = ["kit-procedure-suggestions", kitItemId];
  const { data, isLoading } = useQuery<KitSuggestionResult>({
    queryKey: key,
    queryFn: () => suggestFn({ data: { kitItemId } }),
    enabled: Boolean(kitItemId),
  });

  const attach = useMutation({
    mutationFn: (procedureName: string) =>
      linkFn({ data: { procedureName, kind: "inventory" as const, targetId: kitItemId } }),
    onSuccess: (_r, procedureName) => {
      toast.success(`Attached "${procedureName}" to this kit`);
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["procedures"] });
      qc.invalidateQueries({ queryKey: ["procedure-links"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Looking for matching kit procedures…
      </div>
    );
  }
  const suggestions = data?.suggestions ?? [];
  if (suggestions.length === 0) return null;

  return (
    <div className="rounded-md border border-border p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <BookOpen className="h-4 w-4" />
        Suggested procedures for this kit
        <Badge variant="secondary">{suggestions.length}</Badge>
      </div>
      <ul className="space-y-2">
        {suggestions.map((s) => (
          <li key={s.name} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm">{s.name}</div>
              <div className="text-xs text-muted-foreground">
                {s.reason}
                {s.type ? ` · ${s.type}` : ""} · {Math.round(s.score * 100)}% match
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={attach.isPending}
              onClick={() => attach.mutate(s.name)}
            >
              <Link2 className="mr-1 h-3 w-3" /> Attach
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
