import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AppLayout } from "@/components/app-layout";
import { PublishStatusPanel } from "@/components/publish-status-panel";
import { useSelfHostConfig } from "@/hooks/use-self-host-config";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { Button } from "@/components/ui/button";
import { obsidianExport, obsidianImport, type ObsidianFile } from "@/lib/obsidian.functions";
import { VAULT_ROOT, TOP_LEVEL_FOLDERS } from "@/lib/obsidian-layout";
import { toast } from "sonner";
import { FolderOpen, Download, Upload, RefreshCw, CheckCircle2, XCircle, Monitor, FileText } from "lucide-react";

export const Route = createFileRoute("/sync")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({ meta: [{ title: "Obsidian Sync — Bostead Farms" }] }),
  component: SyncPage,
});

type DirHandle = FileSystemDirectoryHandle;

async function writeFile(root: DirHandle, path: string, content: string) {
  const fullPath = `${VAULT_ROOT}/${path}`;
  const parts = fullPath.split("/");
  let dir: DirHandle = root;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i], { create: true });
  }
  const file = await dir.getFileHandle(parts[parts.length - 1], { create: true });
  const writable = await file.createWritable();
  await writable.write(content);
  await writable.close();
}

async function readMarkdownRecursive(dir: DirHandle, prefix: string, out: ObsidianFile[]) {
  for await (const entry of (dir as unknown as { values: () => AsyncIterable<FileSystemHandle> }).values()) {
    const childPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === "directory") {
      await readMarkdownRecursive(entry as FileSystemDirectoryHandle, childPath, out);
    } else if (entry.name.toLowerCase().endsWith(".md")) {
      const file = await (entry as FileSystemFileHandle).getFile();
      const content = await file.text();
      out.push({ path: childPath, content });
    }
  }
}

async function readAllMarkdown(root: DirHandle): Promise<ObsidianFile[]> {
  const out: ObsidianFile[] = [];
  let vaultDir: DirHandle;
  try {
    vaultDir = await root.getDirectoryHandle(VAULT_ROOT, { create: false });
  } catch {
    // fall back to treating the picked folder itself as the vault root
    vaultDir = root;
  }
  for (const folder of TOP_LEVEL_FOLDERS) {
    let dir: DirHandle;
    try {
      dir = await vaultDir.getDirectoryHandle(folder, { create: false });
    } catch {
      continue;
    }
    await readMarkdownRecursive(dir, folder, out);
  }
  return out;
}

function SyncPage() {
  const selfHost = useSelfHostConfig();
  const hidePublish = selfHost.data?.selfHostMode ?? false;
  const [vault, setVault] = useState<DirHandle | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [pickerIssue, setPickerIssue] = useState<string | null>(null);
  const doExport = useServerFn(obsidianExport);
  const doImport = useServerFn(obsidianImport);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const supported =
    typeof window !== "undefined" && "showDirectoryPicker" in window;
  const isEmbedded = (() => {
    if (typeof window === "undefined") return false;
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  })();
  const isSecure = typeof window !== "undefined" ? window.isSecureContext : true;

  const pickVault = async () => {
    setPickerIssue(null);
    try {
      // @ts-expect-error — FSA API
      const handle: DirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
      setVault(handle);
      toast.success(`Vault selected: ${handle.name}`);
    } catch (e) {
      const error = e as Error;
      if (error.name !== "AbortError") {
        const message = error.message || "Chrome blocked the folder picker in this view.";
        setPickerIssue(message);
        toast.error(`Could not open folder: ${message}`);
      }
    }
  };

  const pushToVault = async () => {
    if (!vault) return;
    setBusy("Exporting…");
    try {
      const { files } = await doExport();
      for (const f of files) await writeFile(vault, f.path, f.content);
      setLastSync(new Date().toLocaleString());
      toast.success(`Wrote ${files.length} files to vault`);
    } catch (e) {
      toast.error(`Push failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const pullFromVault = async () => {
    if (!vault) return;
    setBusy("Importing…");
    try {
      const files = await readAllMarkdown(vault);
      if (files.length === 0) {
        toast.message(`No markdown files found inside ${VAULT_ROOT}/`);
        return;
      }
      const result = await doImport({ data: { files } });
      setLastSync(new Date().toLocaleString());
      toast.success(
        `Imported ${result.dailyNotes} notes · ${result.tasks} tasks · ${result.projects} projects · ${result.summaries} summaries · ${result.inventory} inventory · ${result.maintenance} maintenance · ${result.consumables} consumables`,
      );
    } catch (e) {
      toast.error(`Pull failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const roundTrip = async () => {
    await pullFromVault();
    await pushToVault();
  };

  const fallbackPush = async () => {
    setBusy("Exporting…");
    try {
      const { files } = await doExport();
      for (const f of files) {
        const blob = new Blob([f.content], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = f.path.replace(/\//g, "_");
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
      setLastSync(new Date().toLocaleString());
      toast.success(`Downloaded ${files.length} files`);
    } catch (e) {
      toast.error(`Export failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const fallbackPull = async (e: { target: HTMLInputElement }) => {
    const selected = e.target.files;
    if (!selected || selected.length === 0) return;
    setBusy("Importing…");
    try {
      const files: ObsidianFile[] = [];
      for (let i = 0; i < selected.length; i++) {
        const file = selected[i];
        if (!file.name.toLowerCase().endsWith(".md")) continue;
        const content = await file.text();
        const path = file.webkitRelativePath || file.name;
        files.push({ path, content });
      }
      if (files.length === 0) {
        toast.message("No markdown files selected.");
        return;
      }
      const result = await doImport({ data: { files } });
      setLastSync(new Date().toLocaleString());
      toast.success(
        `Imported ${result.dailyNotes} notes · ${result.tasks} tasks · ${result.projects} projects · ${result.summaries} summaries · ${result.inventory} inventory · ${result.maintenance} maintenance · ${result.consumables} consumables`,
      );
    } catch (err) {
      toast.error(`Import failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">Obsidian Sync</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Two-way sync between Bostead Farms and a local Obsidian vault folder. All files live
            under a top-level <code>{VAULT_ROOT}/</code> folder, with daily notes, weekly status,
            and monthly/quarterly/yearly project rollups under <code>00 Projects/</code> and
            inventory items grouped by type (e.g. <code>20 Outbuildings/</code>,{" "}
            <code>30 Equipment/31 Parts Catalog/</code>).
          </p>
        </header>

        {!hidePublish && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Publish status
            </h2>
            <PublishStatusPanel />
          </section>
        )}




        {!supported || !isSecure || isEmbedded || pickerIssue ? (
          <div className="border border-border rounded-lg bg-card/40 p-5 space-y-4">
            <div className="flex items-start gap-3">
              <Monitor className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
              <div className="space-y-2">
                <p className="text-sm font-medium">Folder picker availability</p>
                <p className="text-xs text-muted-foreground">
                  The <strong>Pick folder</strong> feature uses Chrome’s File System Access API. It works in Chrome, Edge, and Brave on secure pages, but Chrome can block it inside embedded preview frames. If you’re in Chrome on Mac and the picker doesn’t open, use the direct tab option below.
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span className="flex items-center gap-1 text-emerald-400"><CheckCircle2 className="w-3.5 h-3.5" /> Chrome</span>
                  <span className="flex items-center gap-1 text-emerald-400"><CheckCircle2 className="w-3.5 h-3.5" /> Edge</span>
                  <span className="flex items-center gap-1 text-emerald-400"><CheckCircle2 className="w-3.5 h-3.5" /> Brave</span>
                  <span className="flex items-center gap-1 text-red-400"><XCircle className="w-3.5 h-3.5" /> Safari</span>
                  <span className="flex items-center gap-1 text-red-400"><XCircle className="w-3.5 h-3.5" /> Firefox</span>
                </div>
                {isEmbedded ? (
                  <p className="text-xs text-amber-300">
                    You appear to be using the embedded preview. Open this page in its own Chrome tab, then click <strong>Pick folder</strong> again.
                  </p>
                ) : null}
                {!isSecure ? (
                  <p className="text-xs text-amber-300">
                    Folder access requires a secure HTTPS page.
                  </p>
                ) : null}
                {pickerIssue ? (
                  <p className="text-xs text-amber-300">Chrome reported: {pickerIssue}</p>
                ) : null}
              </div>
            </div>

            <div className="border-t border-border pt-4 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Fallback options</p>
              <div className="flex flex-wrap gap-2">
                {isEmbedded ? (
                  <Button size="sm" variant="secondary" onClick={() => window.open(window.location.href, "_blank", "noopener,noreferrer")}>
                    <FolderOpen className="w-4 h-4 mr-2" />
                    Open in Chrome tab
                  </Button>
                ) : null}
                <Button size="sm" variant="secondary" onClick={fallbackPush} disabled={!!busy}>
                  <Download className="w-4 h-4 mr-2" />
                  Download all files
                </Button>
                <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={!!busy}>
                  <FileText className="w-4 h-4 mr-2" />
                  Import from files…
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".md"
                  className="hidden"
                  onChange={fallbackPull}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                <strong>Download</strong> exports every note as individual files you can drag into your vault.
                <strong>Import</strong> lets you select vault markdown files to upload back into Bostead.
              </p>
            </div>
          </div>
        ) : null}

        <div className="border border-border rounded-lg p-4 space-y-3 bg-card/30">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Vault folder</div>
              <div className="text-xs text-muted-foreground">
                {vault ? vault.name : "No vault selected. Pick the Obsidian vault folder to begin."}
              </div>
            </div>
            <Button onClick={pickVault} variant="outline" disabled={!supported}>
              <FolderOpen className="w-4 h-4 mr-2" />
              {vault ? "Change…" : "Pick folder…"}
            </Button>
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-3">
          <Button onClick={pullFromVault} disabled={!vault || !!busy} variant="secondary">
            <Download className="w-4 h-4 mr-2" />
            Pull from vault
          </Button>
          <Button onClick={pushToVault} disabled={!vault || !!busy}>
            <Upload className="w-4 h-4 mr-2" />
            Push to vault
          </Button>
          <Button onClick={roundTrip} disabled={!vault || !!busy} variant="outline">
            <RefreshCw className="w-4 h-4 mr-2" />
            Pull + Push
          </Button>
        </div>

        {busy ? <div className="text-sm text-muted-foreground">{busy}</div> : null}
        {lastSync ? (
          <div className="text-xs text-muted-foreground">Last sync: {lastSync}</div>
        ) : null}

        <div className="text-xs text-muted-foreground border-t border-border pt-4 space-y-1">
          <p><strong>Pull</strong> reads every <code>.md</code> in the four folders and upserts into Bostead by <code>bostead.id</code> / slug.</p>
          <p><strong>Push</strong> writes the current Bostead data into the vault, overwriting matching files.</p>
          <p>The folder permission is granted per session — re-pick after closing the tab.</p>
        </div>
      </div>
    </AppLayout>
  );
}
