// Admin approval gate for nameplate → equipment writes.
//
// Nothing reaches `electrical_loads` until an administrator approves here, and
// each field can be approved individually (e.g. accept the model number, hold
// the MOCP back because the digit was smudged).
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  decideNameplateWriteRequest,
  listNameplateWriteRequests,
  type NameplateWriteReview,
} from "@/lib/electrical-nameplate-write.functions";
import { NAMEPLATE_WRITE_GATE_NOTE } from "@/lib/electrical-nameplate-write";

export function NameplateWriteQueueCard() {
  const list = useServerFn(listNameplateWriteRequests);
  const { data, isLoading } = useQuery({
    queryKey: ["nameplate-write-requests", "pending"],
    queryFn: () => list({ data: { status: "pending" } }),
  });

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">Nameplate write requests</CardTitle>
        <p className="text-xs text-muted-foreground">{NAMEPLATE_WRITE_GATE_NOTE}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (data?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">
            No nameplate readings are waiting for approval.
          </p>
        ) : (
          data!.map((req) => <RequestRow key={req.id} req={req} />)
        )}
      </CardContent>
    </Card>
  );
}

function RequestRow({ req }: { req: NameplateWriteReview }) {
  const decide = useServerFn(decideNameplateWriteRequest);
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});

  const chosen = useMemo(
    () => req.changes.filter((c) => !skipped[c.id]).map((c) => c.id),
    [req.changes, skipped],
  );

  const mutation = useMutation({
    mutationFn: (decision: "approved" | "rejected") =>
      decide({
        data: {
          id: req.id,
          decision,
          ...(decision === "approved" ? { fields: chosen } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      }),
    onSuccess: (_res, decision) => {
      toast.success(
        decision === "approved"
          ? `Applied ${chosen.length} nameplate field${chosen.length === 1 ? "" : "s"} to ${req.load_ref ?? "the equipment row"}.`
          : "Request declined. Nothing was written.",
      );
      void queryClient.invalidateQueries({ queryKey: ["nameplate-write-requests"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "That decision could not be saved"),
  });

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="outline">{req.load_ref ?? "load"}</Badge>
        <span className="font-medium">{req.load_label ?? "Equipment row"}</span>
        <span className="text-xs text-muted-foreground">
          {req.requester_email ?? "unknown requester"} ·{" "}
          {new Date(req.created_at).toLocaleString("en-US", { timeZone: "America/New_York" })}
        </span>
      </div>

      {req.request_note ? (
        <p className="text-xs text-muted-foreground">Note: {req.request_note}</p>
      ) : null}

      {req.changes.length === 0 ? (
        <p className="text-xs text-amber-700">
          The equipment row already matches this reading — approving would change nothing.
        </p>
      ) : (
        <div className="space-y-1">
          {req.changes.map((c) => (
            <label
              key={c.id}
              className="flex items-start gap-2 rounded border p-2 text-sm"
              htmlFor={`${req.id}-${c.id}`}
            >
              <Checkbox
                id={`${req.id}-${c.id}`}
                checked={!skipped[c.id]}
                onCheckedChange={(v) =>
                  setSkipped((prev) => ({ ...prev, [c.id]: v !== true }))
                }
              />
              <span className="min-w-0">
                <span className="font-medium">{c.label}</span>{" "}
                <span className="text-muted-foreground">
                  {c.current ?? "empty"} → {c.proposed}
                </span>
                {c.overwrite ? (
                  <span className="ml-2 text-xs text-amber-700">replaces a recorded value</span>
                ) : null}
              </span>
            </label>
          ))}
        </div>
      )}

      <Input
        value={note}
        placeholder="Decision note (optional)"
        maxLength={300}
        onChange={(e) => setNote(e.target.value)}
      />

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={mutation.isPending || chosen.length === 0}
          onClick={() => mutation.mutate("approved")}
        >
          Approve {chosen.length} field{chosen.length === 1 ? "" : "s"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate("rejected")}
        >
          Decline
        </Button>
      </div>
    </div>
  );
}
