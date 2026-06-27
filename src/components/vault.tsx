import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Eye, EyeOff, Copy, Plus, Trash2, Pencil, Lock, Users } from "lucide-react";

import {
  listVaultItems,
  createVaultItem,
  updateVaultItem,
  deleteVaultItem,
  revealVaultItem,
  type VaultItem,
  type VaultScope,
} from "@/lib/vault.functions";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";

export function Vault() {
  const [scope, setScope] = useState<VaultScope>("personal");
  return (
    <Tabs value={scope} onValueChange={(v) => setScope(v as VaultScope)}>
      <TabsList>
        <TabsTrigger value="personal" className="gap-2"><Lock size={14}/> Personal</TabsTrigger>
        <TabsTrigger value="shared" className="gap-2"><Users size={14}/> Shared</TabsTrigger>
      </TabsList>
      <TabsContent value="personal" className="mt-4"><VaultPane scope="personal" /></TabsContent>
      <TabsContent value="shared" className="mt-4"><VaultPane scope="shared" /></TabsContent>
    </Tabs>
  );
}

function VaultPane({ scope }: { scope: VaultScope }) {
  const qc = useQueryClient();
  const list = useServerFn(listVaultItems);
  const create = useServerFn(createVaultItem);
  const update = useServerFn(updateVaultItem);
  const del = useServerFn(deleteVaultItem);

  const items = useQuery({
    queryKey: ["vault", scope],
    queryFn: () => list({ data: { scope } }),
  });

  const [editing, setEditing] = useState<VaultItem | "new" | null>(null);

  const createMut = useMutation({
    mutationFn: (v: { title: string; value: string; notes: string; env_key: string }) =>
      create({ data: { scope, title: v.title, value: v.value, notes: v.notes || null, env_key: scope === "shared" ? (v.env_key || null) : null } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vault", scope] }); setEditing(null); toast.success("Secret saved"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  const updateMut = useMutation({
    mutationFn: (v: { id: string; title: string; value?: string; notes?: string | null; env_key?: string | null }) =>
      update({ data: v }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vault", scope] }); setEditing(null); toast.success("Updated"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vault", scope] }); toast.success("Deleted"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {scope === "personal"
            ? "Only you can see your personal secrets. Stored encrypted on the server."
            : "Shared with all household members. Editors and admins can modify; everyone signed in can read."}
        </div>
        <Button size="sm" onClick={() => setEditing("new")}><Plus size={14}/> Add secret</Button>
      </div>

      {items.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {items.error && <div className="text-sm text-destructive">{(items.error as Error).message}</div>}

      <ul className="divide-y rounded-md border">
        {(items.data ?? []).map((it) => (
          <VaultRow
            key={it.id}
            item={it}
            onEdit={() => setEditing(it)}
            onDelete={() => { if (confirm(`Delete "${it.title}"?`)) deleteMut.mutate(it.id); }}
          />
        ))}
        {items.data?.length === 0 && (
          <li className="p-4 text-sm text-muted-foreground">No secrets yet.</li>
        )}
      </ul>

      {editing && (
        <VaultEditor
          scope={scope}
          item={editing === "new" ? null : editing}
          onCancel={() => setEditing(null)}
          onSubmit={(v) => {
            if (editing === "new") createMut.mutate(v);
            else updateMut.mutate({
              id: editing.id,
              title: v.title,
              value: v.value || undefined,
              notes: v.notes,
              env_key: scope === "shared" ? (v.env_key || null) : undefined,
            });
          }}
          submitting={createMut.isPending || updateMut.isPending}
        />
      )}
    </div>
  );
}

function VaultRow({ item, onEdit, onDelete }: { item: VaultItem; onEdit: () => void; onDelete: () => void }) {
  const reveal = useServerFn(revealVaultItem);
  const [revealed, setRevealed] = useState<{ value: string; notes: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (revealed) { setRevealed(null); return; }
    setBusy(true);
    try {
      const r = await reveal({ data: { id: item.id } });
      setRevealed({ value: r.value, notes: r.notes });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  async function copyValue() {
    setBusy(true);
    try {
      const r = revealed ?? await reveal({ data: { id: item.id } });
      await navigator.clipboard.writeText(r.value);
      toast.success("Copied to clipboard");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  return (
    <li className="p-3 flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{item.title}</div>
        <div className="mt-1 font-mono text-xs break-all">
          {revealed ? revealed.value : "•".repeat(12)}
        </div>
        {revealed?.notes && (
          <div className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">{revealed.notes}</div>
        )}
        {!revealed && item.has_notes && (
          <div className="mt-1 text-xs text-muted-foreground italic">Notes hidden — reveal to view</div>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" onClick={toggle} disabled={busy} title={revealed ? "Hide" : "Reveal"}>
          {revealed ? <EyeOff size={14}/> : <Eye size={14}/>}
        </Button>
        <Button size="sm" variant="ghost" onClick={copyValue} disabled={busy} title="Copy value"><Copy size={14}/></Button>
        <Button size="sm" variant="ghost" onClick={onEdit} title="Edit"><Pencil size={14}/></Button>
        <Button size="sm" variant="ghost" onClick={onDelete} title="Delete"><Trash2 size={14}/></Button>
      </div>
    </li>
  );
}

function VaultEditor({
  item, onCancel, onSubmit, submitting,
}: {
  item: VaultItem | null;
  onCancel: () => void;
  onSubmit: (v: { title: string; value: string; notes: string }) => void;
  submitting: boolean;
}) {
  const reveal = useServerFn(revealVaultItem);
  const [title, setTitle] = useState(item?.title ?? "");
  const [value, setValue] = useState("");
  const [notes, setNotes] = useState("");
  const [loaded, setLoaded] = useState(!item);

  async function loadExisting() {
    if (!item) return;
    try {
      const r = await reveal({ data: { id: item.id } });
      setValue(r.value);
      setNotes(r.notes ?? "");
      setLoaded(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item ? "Edit secret" : "New secret"}</DialogTitle>
          <DialogDescription>
            Values are encrypted on the server before storage.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="v-title">Title</Label>
            <Input id="v-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Bank login" />
          </div>
          <div>
            <Label htmlFor="v-value">Secret value</Label>
            {item && !loaded ? (
              <div className="text-xs">
                <Button type="button" size="sm" variant="outline" onClick={loadExisting}>
                  Load current value to edit
                </Button>
                <span className="ml-2 text-muted-foreground">Leave alone to keep the existing value.</span>
              </div>
            ) : (
              <Textarea id="v-value" value={value} onChange={(e) => setValue(e.target.value)} placeholder={item ? "(leave empty to keep current)" : ""} rows={3} />
            )}
          </div>
          <div>
            <Label htmlFor="v-notes">Notes</Label>
            <Textarea id="v-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} disabled={!loaded && !!item} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button
            disabled={submitting || !title.trim() || (!item && !value)}
            onClick={() => onSubmit({ title: title.trim(), value, notes })}
          >
            {submitting ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
