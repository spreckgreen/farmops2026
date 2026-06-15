import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AppLayout } from "@/components/app-layout";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { Button } from "@/components/ui/button";
import { obsidianExport, obsidianImport, type ObsidianFile } from "@/lib/obsidian.functions";
import { toast } from "sonner";
import { FolderOpen, Download, Upload, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/sync")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({ meta: [{ title: "Obsidian Sync — Bostead Farms" }] }),
  component: SyncPage,
});

type DirHandle = FileSystemDirectoryHandle;

const FOLDERS = ["Daily", "Tasks", "Projects", "Summaries"];

async function getOrCreateSubdir(root: DirHandle, name: string): Promise<DirHandle> {
  return root.getDirectoryHandle(name, { create: true });
}

async function writeFile(root: DirHandle, path: string, content: string) {
  const parts = path.split("/");
  let dir: DirHandle = root;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i], { create: true });
  }
  const file = await dir.getFileHandle(parts[parts.length - 1], { create: true });
  const writable = await file.createWritable();
  await writable.write(content);
  await writable.close();
}

async function readAllMarkdown(root: DirHandle): Promise<ObsidianFile[]> {
  const out: ObsidianFile[] = [];
  for (const folder of FOLDERS) {
    let dir: DirHandle;
    try {
      dir = await root.getDirectoryHandle(folder, { create: false });
    } catch {
      continue;
    }
    // @ts-expect-error — values() is supported in browsers exposing FSA API
    for await (const entry of dir.values()) {
      if (entry.kind !== "file") continue;
      if (!entry.name.toLowerCase().endsWith(".md")) continue;
      const file = await (entry as FileSystemFileHandle).getFile();
      const content = await file.text();
      out.push({ path: `${folder}/${entry.name}`, content });
    }
  }
  return out;
}

function SyncPage() {
  const [vault, setVault] = useState<DirHandle | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const doExport = useServerFn(obsidianExport);
  const doImport = useServerFn(obsidianImport);

  const supported =
    typeof window !== "undefined" && "showDirectoryPicker" in window;

  const pickVault = async () => {
    try {
      // @ts-expect-error — FSA API
      const handle: DirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
      setVault(handle);
      toast.success(`Vault selected: ${handle.name}`);
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast.error("Could not open folder");
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
        toast.message("No markdown files found in Daily/, Tasks/, Projects/, Summaries/");
        return;
      }
      const result = await doImport({ data: { files } });
      setLastSync(new Date().toLocaleString());
      toast.success(
        `Imported ${result.dailyNotes} notes, ${result.tasks} tasks, ${result.projects} projects, ${result.summaries} summaries`,
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

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">Obsidian Sync</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Two-way sync between Bostead Farms and a local Obsidian vault folder. Files live
            under <code>Daily/</code>, <code>Tasks/</code>, <code>Projects/</code>, and{" "}
            <code>Summaries/</code> with YAML frontmatter for round-tripping.
          </p>
        </header>

        {!supported ? (
          <div className="border border-destructive/50 bg-destructive/10 text-destructive rounded-md p-4 text-sm">
            Your browser doesn't support the File System Access API. Use Chrome, Edge, or Brave.
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
