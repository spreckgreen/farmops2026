// Requester-side control on the read-only panel sheet: ask an administrator for
// a 24-hour edit window, then show exactly where that request stands.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { requestPanelEditAccess } from "@/lib/panel-access.functions";
import { remainingLabel, type PanelAccessState } from "@/lib/electrical-panel-access";
import type { PanelSheetAccess, SystemDataAccess } from "@/lib/panel-access.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Clock, Globe, Lock, PencilLine, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

const STATE_TEXT: Record<PanelAccessState, string> = {
  none: "Read-only",
  pending: "Approval pending",
  active: "Editing unlocked",
  expired: "Window expired",
  revoked: "Access revoked",
  rejected: "Request declined",
};

export function PanelAccessRequest({
  panelId,
  access,
  onChanged,
}: {
  panelId: string;
  access: PanelSheetAccess;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const submit = useServerFn(requestPanelEditAccess);

  const mutation = useMutation({
    mutationFn: () =>
      submit({
        data: {
          panelId,
          scope: "panel_edit" as const,
          reason: reason.trim() || undefined,
          reviewUrl:
            typeof window === "undefined" ? undefined : `${window.location.origin}/admin/panel-access`,
        },
      }),
    onSuccess: (result) => {
      setOpen(false);
      setReason("");
      toast.success(
        result.duplicate
          ? "You already have an open request for this panel."
          : "Request sent for approval.",
        { description: result.notified ?? undefined },
      );
      onChanged();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Could not send the request."),
  });

  if (access.is_admin) {
    return (
      <Badge variant="secondary" className="gap-1">
        <ShieldCheck className="h-3.5 w-3.5" /> Administrator — editing enabled
      </Badge>
    );
  }

  if (access.state === "active") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="gap-1">
          <PencilLine className="h-3.5 w-3.5" /> {STATE_TEXT.active}
        </Badge>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" /> {remainingLabel(access.expires_at)}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="outline" className="gap-1">
        <Lock className="h-3.5 w-3.5" /> {STATE_TEXT[access.state]}
      </Badge>
      {access.state === "pending" ? (
        <span className="text-xs text-muted-foreground">
          An administrator has to approve it before you can edit.
        </span>
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              Request edit access
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Request edit access to {panelId}</DialogTitle>
              <DialogDescription>
                An administrator reviews the request and, if approved, you get a{" "}
                {access.window_hours}-hour window to correct this panel's details. The window closes
                on its own.
              </DialogDescription>
            </DialogHeader>
            {access.state === "rejected" && access.request?.decision_note ? (
              <Alert>
                <AlertDescription className="text-xs">
                  Previous decision: {access.request.decision_note}
                </AlertDescription>
              </Alert>
            ) : null}
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="What needs correcting? e.g. breaker 29 is a 2-pole mini split, label sheet is wrong"
              rows={3}
            />
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
                {mutation.isPending ? "Sending…" : "Send request"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/**
 * Second, separate request: read beyond the scanned panel (other panels and the
 * whole-system topology). Same approval pipeline — in-app queue, notification to
 * administrators, administrator second factor on the decision, 24-hour window.
 */
export function SystemDataAccessRequest({
  panelId,
  access,
  onChanged,
}: {
  panelId: string;
  access: SystemDataAccess;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const submit = useServerFn(requestPanelEditAccess);

  const mutation = useMutation({
    mutationFn: () =>
      submit({
        data: {
          panelId,
          scope: "system_data" as const,
          reason: reason.trim() || undefined,
          reviewUrl:
            typeof window === "undefined"
              ? undefined
              : `${window.location.origin}/admin/panel-access`,
        },
      }),
    onSuccess: (result) => {
      setOpen(false);
      setReason("");
      toast.success(
        result.duplicate
          ? "You already have an open request for wider electrical data."
          : "Request sent for approval.",
        { description: result.notified ?? undefined },
      );
      onChanged();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Could not send the request."),
  });

  if (access.granted) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="gap-1">
          <Globe className="h-3.5 w-3.5" /> Full electrical access
        </Badge>
        {access.expires_at ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" /> {remainingLabel(access.expires_at)}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="outline" className="gap-1">
        <Lock className="h-3.5 w-3.5" /> Scoped to {panelId}
      </Badge>
      {access.state === "pending" ? (
        <span className="text-xs text-muted-foreground">
          Wider access requested — waiting on an administrator.
        </span>
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              Request other panels / system data
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Request wider electrical access</DialogTitle>
              <DialogDescription>
                This label only opens {panelId} and its local topology. An administrator can grant
                you a {access.window_hours}-hour window to read other panels and the full system
                topology. The window closes on its own.
              </DialogDescription>
            </DialogHeader>
            {access.state === "rejected" && access.request?.decision_note ? (
              <Alert>
                <AlertDescription className="text-xs">
                  Previous decision: {access.request.decision_note}
                </AlertDescription>
              </Alert>
            ) : null}
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is deeper information needed? e.g. tracing the feeder back through PNL-FS-CRIT to size a new subpanel"
              rows={3}
            />
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
                {mutation.isPending ? "Sending…" : "Send request"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
