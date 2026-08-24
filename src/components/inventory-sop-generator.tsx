// "Write an SOP for an inventory item" panel on the Procedures page.
// Pick an item, optionally add focus notes, draft the SOP with AI, edit it,
// then save it as a procedure linked back to that item.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, ClipboardList, Loader2, Save, Sparkles } from "lucide-react";
import { AiTruncationWarning } from "@/components/ai-truncation-warning";
import {
  draftInventorySop,
  listSopInventoryTargets,
  saveInventorySop,
  type SopDraft,
} from "@/lib/procedure-sop.functions";

export function InventorySopGenerator({
  onSaved,
}: {
  onSaved?: (name: string) => void;
}) {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listSopInventoryTargets);
  const draftFn = useServerFn(draftInventorySop);
  const saveFn = useServerFn(saveInventorySop);

  const [itemId, setItemId] = useState<string>("");
  const [focus, setFocus] = useState("");
  const [draft, setDraft] = useState<SopDraft | null>(null);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["sop-inventory-targets"],
    queryFn: () => listFn({}),
  });

  const selected = useMemo(() => items.find((i) => i.id === itemId) ?? null, [items, itemId]);

  const generate = useMutation({
    mutationFn: () => draftFn({ data: { inventoryItemId: itemId, focus: focus.trim() } }),
    onSuccess: (d) => {
      setDraft(d);
      setName(d.suggestedName);
      setBody(d.body);
      if (d.escalation) toast.info(d.escalation.detail);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const save = useMutation({
    mutationFn: () =>
      saveFn({ data: { inventoryItemId: itemId, name: name.trim(), body, mode: saveMode } }),
    onSuccess: (r) => {
      const verb = r.appended ? "Added to" : "Saved";
      toast.success(
        r.linked
          ? `${verb} "${r.name}" and linked it to ${selected?.name ?? "the item"}`
          : `${verb} "${r.name}"`,
      );
      setDraft(null);
      setBody("");
      setFocus("");
      queryClient.invalidateQueries({ queryKey: ["procedures"] });
      queryClient.invalidateQueries({ queryKey: ["sop-inventory-targets"] });
      onSaved?.(r.name);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardContent className="pt-6 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ClipboardList className="h-4 w-4 text-primary" />
          Write an SOP for an inventory item
        </div>

        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Select value={itemId} onValueChange={(v) => { setItemId(v); setDraft(null); }}>
            <SelectTrigger>
              <SelectValue
                placeholder={isLoading ? "Loading inventory…" : "Choose an inventory item…"}
              />
            </SelectTrigger>
            <SelectContent>
              {items.map((i) => (
                <SelectItem key={i.id} value={i.id}>
                  {i.name}
                  {i.sku ? ` · ${i.sku}` : ""}
                  {i.hasSop ? " · has a procedure" : ""}
                </SelectItem>
              ))}
              {items.length === 0 && !isLoading ? (
                <div className="px-2 py-3 text-xs text-muted-foreground italic">
                  No inventory items yet
                </div>
              ) : null}
            </SelectContent>
          </Select>
          <Button
            onClick={() => generate.mutate()}
            disabled={!itemId || generate.isPending}
          >
            {generate.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Drafting…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-1" /> Draft SOP
              </>
            )}
          </Button>
        </div>

        <Textarea
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          rows={2}
          maxLength={1000}
          placeholder="Optional focus — e.g. winterizing and blade sharpening, or operator training for a new helper"
        />
        <p className="text-xs text-muted-foreground">
          The draft uses the item's record, its maintenance history, and any procedures already
          linked to it. Saving files it under Procedures and links it back to the item.
        </p>

        {generate.error ? (
          <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 p-3 text-sm flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5" />
            <span>{(generate.error as Error).message}</span>
          </div>
        ) : null}

        {draft ? (
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <AiTruncationWarning signal={draft.truncation} />
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              placeholder="Procedure name"
              className="font-mono text-sm"
            />
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={16}
              className="font-mono text-xs"
              spellCheck={false}
            />
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t text-xs text-muted-foreground">
              <Badge variant="secondary" className="font-mono">{draft.model}</Badge>
              <span>{draft.latencyMs} ms</span>
              <span>
                · saw {draft.contextUsed.maintenanceRecords} service record
                {draft.contextUsed.maintenanceRecords === 1 ? "" : "s"},{" "}
                {draft.contextUsed.linkedProcedures} linked procedure
                {draft.contextUsed.linkedProcedures === 1 ? "" : "s"}
              </span>
              <div className="ml-auto flex items-center gap-2">
                <select
                  value={saveMode}
                  onChange={(e) =>
                    setSaveMode(e.target.value as "create" | "append" | "replace")
                  }
                  className="rounded-md border border-border bg-card/60 px-2 py-1 text-xs text-foreground"
                  title="What to do if a procedure with this name already exists"
                >
                  <option value="create">New page</option>
                  <option value="append">Append to existing</option>
                  <option value="replace">Replace existing</option>
                </select>
                <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
                  Discard
                </Button>
                <Button
                  size="sm"
                  onClick={() => save.mutate()}
                  disabled={save.isPending || !name.trim() || !body.trim()}
                >
                  {save.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Saving…
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-1" /> Save as procedure
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
