// Record or correct one camera. Every field is something a person can verify at
// the camera itself; nothing is guessed on their behalf.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CAMERA_STREAM_KINDS,
  CAMERA_STREAM_KIND_LABEL,
  streamUrlProblem,
  suggestStreamKind,
  type CameraRow,
  type CameraStreamKind,
} from "@/lib/cameras";

export interface CameraDraft {
  id?: string | null;
  camera_id: string;
  name: string;
  area: string;
  building: string;
  mount: string;
  stream_kind: CameraStreamKind;
  stream_url: string;
  snapshot_url: string;
  x_feet: string;
  y_feet: string;
  heading_degrees: string;
  fov_degrees: string;
  range_feet: string;
  electrical_load_ref: string;
  notes: string;
}

export function draftFromRow(row: CameraRow | null, fallbackId: string): CameraDraft {
  return {
    id: row?.id ?? null,
    camera_id: row?.camera_id ?? fallbackId,
    name: row?.name ?? "",
    area: row?.area ?? "",
    building: row?.building ?? "Farm Shop",
    mount: row?.mount ?? "",
    stream_kind: (row?.stream_kind as CameraStreamKind) ?? "none",
    stream_url: row?.stream_url ?? "",
    snapshot_url: row?.snapshot_url ?? "",
    x_feet: row?.x_feet === null || row?.x_feet === undefined ? "" : String(row.x_feet),
    y_feet: row?.y_feet === null || row?.y_feet === undefined ? "" : String(row.y_feet),
    heading_degrees:
      row?.heading_degrees === null || row?.heading_degrees === undefined
        ? ""
        : String(row.heading_degrees),
    fov_degrees: String(row?.fov_degrees ?? 90),
    range_feet: String(row?.range_feet ?? 30),
    electrical_load_ref: row?.electrical_load_ref ?? "",
    notes: row?.notes ?? "",
  };
}

export function CameraEditDialog({
  open,
  draft,
  saving,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  draft: CameraDraft | null;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (draft: CameraDraft) => void;
}) {
  const [form, setForm] = useState<CameraDraft | null>(draft);

  useEffect(() => setForm(draft), [draft]);

  if (!form) return null;
  const urlProblem = streamUrlProblem(form.stream_url);
  const set = (patch: Partial<CameraDraft>) => setForm((prev) => (prev ? { ...prev, ...patch } : prev));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{draft?.id ? `Edit ${draft.camera_id}` : "Add a camera"}</DialogTitle>
          <DialogDescription>
            Position and facing are optional. Leave them blank until you can measure them — a camera
            without them still shows its live feed, it just stays off the coverage map.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="cam-id">Camera ID</Label>
            <Input
              id="cam-id"
              value={form.camera_id}
              onChange={(e) => set({ camera_id: e.target.value.toUpperCase() })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cam-name">Name</Label>
            <Input
              id="cam-name"
              value={form.name}
              placeholder="NE corner exterior"
              onChange={(e) => set({ name: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cam-building">Building</Label>
            <Input
              id="cam-building"
              value={form.building}
              onChange={(e) => set({ building: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cam-area">Area</Label>
            <Input
              id="cam-area"
              value={form.area}
              placeholder="Exterior north"
              onChange={(e) => set({ area: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cam-mount">Mount</Label>
            <Input
              id="cam-mount"
              value={form.mount}
              placeholder="Soffit, 12 ft"
              onChange={(e) => set({ mount: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cam-load">Powered by (electrical record)</Label>
            <Input
              id="cam-load"
              value={form.electrical_load_ref}
              placeholder="FS-002"
              onChange={(e) => set({ electrical_load_ref: e.target.value.toUpperCase() })}
            />
          </div>

          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="cam-kind">Feed type</Label>
            <Select
              value={form.stream_kind}
              onValueChange={(value) => set({ stream_kind: value as CameraStreamKind })}
            >
              <SelectTrigger id="cam-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CAMERA_STREAM_KINDS.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {CAMERA_STREAM_KIND_LABEL[kind]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="cam-url">Feed address</Label>
            <Input
              id="cam-url"
              value={form.stream_url}
              placeholder="https://camera.local/live/stream.m3u8"
              onChange={(e) => {
                const stream_url = e.target.value;
                const suggested = suggestStreamKind(stream_url);
                set(
                  form.stream_kind === "none" && suggested !== "none"
                    ? { stream_url, stream_kind: suggested }
                    : { stream_url },
                );
              }}
            />
            {urlProblem ? <p className="text-xs text-destructive">{urlProblem}</p> : null}
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="cam-snap">Still-image address (used for the reachability check)</Label>
            <Input
              id="cam-snap"
              value={form.snapshot_url}
              placeholder="https://camera.local/snapshot.jpg"
              onChange={(e) => set({ snapshot_url: e.target.value })}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="cam-x">X from west wall (feet)</Label>
            <Input
              id="cam-x"
              inputMode="decimal"
              value={form.x_feet}
              onChange={(e) => set({ x_feet: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cam-y">Y from north wall (feet)</Label>
            <Input
              id="cam-y"
              inputMode="decimal"
              value={form.y_feet}
              onChange={(e) => set({ y_feet: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cam-heading">Facing (0 = north, 90 = east)</Label>
            <Input
              id="cam-heading"
              inputMode="decimal"
              value={form.heading_degrees}
              onChange={(e) => set({ heading_degrees: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cam-fov">View width (degrees)</Label>
            <Input
              id="cam-fov"
              inputMode="decimal"
              value={form.fov_degrees}
              onChange={(e) => set({ fov_degrees: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cam-range">Useful distance (feet)</Label>
            <Input
              id="cam-range"
              inputMode="decimal"
              value={form.range_feet}
              onChange={(e) => set({ range_feet: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="cam-notes">Notes</Label>
            <Textarea
              id="cam-notes"
              value={form.notes}
              rows={3}
              onChange={(e) => set({ notes: e.target.value })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => onSave(form)} disabled={saving || Boolean(urlProblem)}>
            {saving ? "Saving…" : "Save camera"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
