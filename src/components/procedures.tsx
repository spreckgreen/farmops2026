import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Plus, Trash2, Download, Upload, Pencil, Check, X, FileText, Save, ExternalLink, Wand2, FolderSync,
} from "lucide-react";
import { tidyProcedure } from "@/lib/tidy-tinywiki";
import { tinyWikiToMarkdown } from "@/lib/tinywiki-to-md";

import {
  buildTinyWikiHtml,
  extractBodyWiki,
  filenameForExport,
  nameFromFilename,
  validateTinyWikiHtml,
  validateWikiName,
} from "@/lib/tinywiki";
import {
  listProcedures,
  saveProcedureBody,
  saveProcedureHtml,
  renameProcedure,
  deleteProcedure,
  type ProcedureRow,
} from "@/lib/procedures.functions";
import { ProcedureLinks } from "@/components/procedure-links";
import {
  isMaintenancePlan,
  parseProcedureMeta,
  type ProcedureMeta,
} from "@/lib/procedure-meta";


export function Procedures() {
  const qc = useQueryClient();
  const listFn = useServerFn(listProcedures);
  const saveBodyFn = useServerFn(saveProcedureBody);
  const saveHtmlFn = useServerFn(saveProcedureHtml);
  const renameFn = useServerFn(renameProcedure);
  const deleteFn = useServerFn(deleteProcedure);

  const { data: wikis = [] } = useQuery<ProcedureRow[]>({
    queryKey: ["procedures"],
    queryFn: () => listFn(),
  });

  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [filter, setFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "maintenance" | "other">("all");
  const [assetFilter, setAssetFilter] = useState("all");
  const [intervalFilter, setIntervalFilter] = useState("all");
  const fileRef = useRef<HTMLInputElement>(null);


  const invalidate = () => qc.invalidateQueries({ queryKey: ["procedures"] });

  // Default-select first procedure once loaded.
  useEffect(() => {
    if (!wikis.length) {
      if (selected !== null) { setSelected(null); setContent(""); setDirty(false); }
      return;
    }
    if (!selected || !wikis.some((w) => w.name === selected)) {
      const first = wikis[0];
      setSelected(first.name);
      setContent(extractBodyWiki(first.content, first.name));
      setDirty(false);
    } else {
      const cur = wikis.find((w) => w.name === selected);
      if (cur && !dirty) setContent(extractBodyWiki(cur.content, cur.name));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wikis]);

  function selectWiki(name: string) {
    if (dirty && !confirm("Discard unsaved changes?")) return;
    const w = wikis.find((x) => x.name === name);
    if (!w) return;
    setSelected(w.name);
    setContent(extractBodyWiki(w.content, w.name));
    setDirty(false);
    setRenaming(false);
  }

  const saveBodyMut = useMutation({
    mutationFn: (vars: { name: string; body: string }) => saveBodyFn({ data: vars }),
    onSuccess: (row) => {
      toast.success(`Saved "${row.name}"`);
      setDirty(false);
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const saveHtmlMut = useMutation({
    mutationFn: (vars: { name: string; html: string }) => saveHtmlFn({ data: vars }),
  });

  const renameMut = useMutation({
    mutationFn: (vars: { oldName: string; newName: string }) => renameFn({ data: vars }),
    onSuccess: (row) => {
      toast.success(`Renamed to "${row.name}"`);
      setSelected(row.name);
      setRenaming(false);
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const backfillMut = useMutation({
    mutationFn: () => backfillFn({ data: { overwrite: false } }),
    onSuccess: (res) => {
      if (!res.pages.length) {
        toast.info(
          res.skipped.length
            ? `Plan pages already exist for ${res.skipped.length} asset${res.skipped.length === 1 ? "" : "s"}.`
            : "No maintenance records found to build plans from.",
        );
      } else {
        toast.success(
          `Built ${res.pages.length} maintenance plan page${res.pages.length === 1 ? "" : "s"}` +
            (res.skipped.length ? ` — ${res.skipped.length} already existed` : ""),
        );
        setTypeFilter("maintenance");
        setSelected(res.pages[0].name);
      }
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const deleteMut = useMutation({

    mutationFn: (name: string) => deleteFn({ data: { name } }),
    onSuccess: (_d, name) => {
      toast.success(`Deleted "${name}"`);
      setSelected(null);
      setContent("");
      setDirty(false);
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  async function createNew() {
    const raw = prompt("Name for new procedure:");
    if (raw === null) return;
    let name: string;
    try { name = validateWikiName(raw); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); return; }
    if (wikis.some((w) => w.name === name) &&
        !confirm(`"${name}" already exists. Replace?`)) return;
    await saveBodyMut.mutateAsync({
      name,
      body: `! ${name}\n\nDescribe this procedure here using TinyWiki markup.\n`,
    });
    setSelected(name);
  }

  function save() {
    if (!selected) return;
    // Server tidies on save too, but apply locally first so the editor
    // immediately reflects the normalized content.
    const { body } = tidyProcedure(selected, content);
    if (body !== content) { setContent(body); }
    saveBodyMut.mutate({ name: selected, body });
  }

  function tidyNow() {
    if (!selected) return;
    const { body, changes } = tidyProcedure(selected, content);
    if (body === content) { toast.info("Already tidy."); return; }
    setContent(body);
    setDirty(true);
    toast.success(`Tidied ${changes} line${changes === 1 ? "" : "s"} — save to keep changes.`);
  }


  function remove() {
    if (!selected) return;
    if (!confirm(`Delete procedure "${selected}"? This cannot be undone.`)) return;
    deleteMut.mutate(selected);
  }

  function commitRename() {
    if (!selected) return;
    try { validateWikiName(renameValue); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); return; }
    renameMut.mutate({ oldName: selected, newName: renameValue.trim() });
  }

  /** Rebuild the export HTML from the stored wiki body so downloads always use
   *  the current, script-free renderer — older rows were saved with an
   *  inline-script document that Chrome can blank out under blob:/file: CSP. */
  function exportHtmlFor(w: ProcedureRow): string {
    const body = extractBodyWiki(w.content, w.name);
    return body ? buildTinyWikiHtml(w.name, body) : w.content;
  }

  function exportOne() {
    if (!selected) return;
    const w = wikis.find((x) => x.name === selected);
    if (!w) return;
    const html = exportHtmlFor(w);
    try { validateTinyWikiHtml(html); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); return; }
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filenameForExport(w.name); a.click();
    URL.revokeObjectURL(url);
  }

  function openInNewTab() {
    if (!selected) return;
    const w = wikis.find((x) => x.name === selected);
    if (!w) return;
    const blob = new Blob([exportHtmlFor(w)], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    if (!win) {
      const a = document.createElement("a");
      a.href = url; a.download = filenameForExport(w.name); a.click();
    }
  }


  async function syncToObsidian() {
    const anyWindow = window as unknown as {
      showDirectoryPicker?: (opts?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
    };
    if (!anyWindow.showDirectoryPicker) {
      toast.error("Your browser doesn't support folder access. Use Chrome, Edge, or another Chromium browser.");
      return;
    }
    if (!wikis.length) { toast.info("No procedures to sync."); return; }
    let vault: FileSystemDirectoryHandle;
    try {
      vault = await anyWindow.showDirectoryPicker({ mode: "readwrite" });
    } catch {
      return; // user cancelled
    }
    try {
      const folder = await vault.getDirectoryHandle("50 Procedures", { create: true });

      // Build the desired state: filename -> markdown content
      const desired = new Map<string, string>();
      for (const w of wikis) {
        const body = extractBodyWiki(w.content, w.name);
        const md = `# ${w.name}\n\n${tinyWikiToMarkdown(body).replace(/^#\s+.*\n+/, "")}`;
        const safe = w.name.replace(/[\\/:*?"<>|]/g, "-");
        desired.set(`${safe}.md`, md);
      }

      // Snapshot existing .md files in the folder
      const existing = new Map<string, FileSystemFileHandle>();
      const dirAny = folder as unknown as { values: () => AsyncIterable<FileSystemHandle> };
      for await (const entry of dirAny.values()) {
        if (entry.kind === "file" && entry.name.toLowerCase().endsWith(".md")) {
          existing.set(entry.name, entry as FileSystemFileHandle);
        }
      }

      let added = 0, updated = 0, unchanged = 0, removed = 0;
      for (const [fname, md] of desired) {
        const existingHandle = existing.get(fname);
        if (existingHandle) {
          const file = await existingHandle.getFile();
          const current = await file.text();
          if (current === md) { unchanged++; continue; }
          const writable = await (existingHandle as unknown as { createWritable: () => Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }> }).createWritable();
          await writable.write(md); await writable.close();
          updated++;
        } else {
          const fh = await folder.getFileHandle(fname, { create: true });
          const writable = await (fh as unknown as { createWritable: () => Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }> }).createWritable();
          await writable.write(md); await writable.close();
          added++;
        }
      }

      // Remove .md files that no longer correspond to a procedure
      for (const fname of existing.keys()) {
        if (!desired.has(fname)) {
          await (folder as unknown as { removeEntry: (name: string) => Promise<void> }).removeEntry(fname);
          removed++;
        }
      }

      const parts = [`+${added}`, `~${updated}`, `=${unchanged}`, `−${removed}`].join(" ");
      toast.success(`Obsidian sync complete (${parts}).`);
    } catch (e) {
      toast.error(`Obsidian sync failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }






  async function onFilesPicked(files: FileList | null) {
    if (!files || !files.length) return;
    const imported: string[] = [];
    const skipped: string[] = [];
    for (const f of Array.from(files)) {
      try {
        if (!/\.html?$/i.test(f.name)) {
          throw new Error("Only TinyWiki .html files can be imported.");
        }
        const text = await f.text();
        const name = nameFromFilename(f.name);
        validateWikiName(name);
        validateTinyWikiHtml(text);
        if (wikis.some((w) => w.name === name) &&
            !confirm(`"${name}" already exists. Replace with imported file?`)) {
          skipped.push(name); continue;
        }
        await saveHtmlMut.mutateAsync({ name, html: text });
        imported.push(name);
      } catch (e) {
        toast.error(`Failed to import ${f.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (imported.length) {
      toast.success(`Imported ${imported.length} procedure${imported.length === 1 ? "" : "s"}`
        + (skipped.length ? ` — ${skipped.length} skipped` : ""));
      invalidate();
      setSelected(imported[imported.length - 1]);
    } else if (skipped.length) {
      toast.info(`${skipped.length} file${skipped.length === 1 ? "" : "s"} skipped.`);
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  // --- Type / asset / interval filtering -------------------------------------
  const meta = useMemo(() => {
    const m = new Map<string, ProcedureMeta>();
    for (const w of wikis) m.set(w.name, parseProcedureMeta(w.content));
    return m;
  }, [wikis]);

  const plansOnly = typeFilter === "maintenance";
  const assetOptions = useMemo(() => {
    const s = new Set<string>();
    for (const w of wikis) {
      const md = meta.get(w.name);
      if (md && isMaintenancePlan(md) && md.asset) s.add(md.asset);
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [wikis, meta]);

  const intervalOptions = useMemo(() => {
    const s = new Set<string>();
    for (const w of wikis) {
      const md = meta.get(w.name);
      if (!md || !isMaintenancePlan(md)) continue;
      if (assetFilter !== "all" && md.asset !== assetFilter) continue;
      for (const i of md.intervals) s.add(i);
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [wikis, meta, assetFilter]);

  const filtered = useMemo(
    () =>
      wikis.filter((w) => {
        if (!w.name.toLowerCase().includes(filter.toLowerCase())) return false;
        const md = meta.get(w.name);
        const isPlan = !!md && isMaintenancePlan(md);
        if (typeFilter === "maintenance" && !isPlan) return false;
        if (typeFilter === "other" && isPlan) return false;
        if (plansOnly && assetFilter !== "all" && md?.asset !== assetFilter) return false;
        if (plansOnly && intervalFilter !== "all" && !md?.intervals.includes(intervalFilter))
          return false;
        return true;
      }),
    [wikis, filter, meta, typeFilter, assetFilter, intervalFilter, plansOnly],
  );


  // Keep saved HTML's embedded title in sync after rename, by regenerating via builder
  // not necessary — server already rebuilds. Just need fresh content on next select.
  // (above effect already refreshes content when wikis list updates)
  void buildTinyWikiHtml;

  return (
    <div className="grid md:grid-cols-[260px_1fr] gap-4 min-h-[420px]">
      <div className="space-y-2 border-r border-border/40 pr-3">
        <div className="flex gap-1">
          <Button size="sm" variant="default" onClick={createNew} className="flex-1">
            <Plus size={14}/> New
          </Button>
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}
            title="Import TinyWiki .html files (replaces same-name)">
            <Upload size={14}/>
          </Button>
          <Button size="sm" variant="outline" onClick={syncToObsidian}
            title="Sync all procedures as Markdown into a “50 Procedures” folder in your chosen Obsidian vault">
            <FolderSync size={14}/>
          </Button>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".html,.htm,text/html"
            className="hidden"
            onChange={(e) => onFilesPicked(e.target.files)}
          />
        </div>
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
          className="h-7 text-xs"
        />
        <Button
          size="sm"
          variant="outline"
          className="w-full text-[11px]"
          onClick={() => backfillMut.mutate()}
          disabled={backfillMut.isPending}
          title="Create Maintenance plan pages from maintenance records that were generated before plan documents existed"
        >
          <Wand2 size={13}/> {backfillMut.isPending ? "Building…" : "Build plan pages"}
        </Button>

        <div className="space-y-1">
          <select
            value={typeFilter}
            onChange={(e) => {
              const v = e.target.value as "all" | "maintenance" | "other";
              setTypeFilter(v);
              if (v !== "maintenance") { setAssetFilter("all"); setIntervalFilter("all"); }
            }}
            className="w-full h-7 rounded border border-border bg-background px-2 text-[11px] font-mono"
            aria-label="Filter by document type"
          >
            <option value="all">All types</option>
            <option value="maintenance">Maintenance plans</option>
            <option value="other">Other procedures</option>
          </select>
          {plansOnly && (
            <>
              <select
                value={assetFilter}
                onChange={(e) => { setAssetFilter(e.target.value); setIntervalFilter("all"); }}
                className="w-full h-7 rounded border border-border bg-background px-2 text-[11px] font-mono"
                aria-label="Filter maintenance plans by asset"
              >
                <option value="all">All assets ({assetOptions.length})</option>
                {assetOptions.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
              <select
                value={intervalFilter}
                onChange={(e) => setIntervalFilter(e.target.value)}
                className="w-full h-7 rounded border border-border bg-background px-2 text-[11px] font-mono"
                aria-label="Filter maintenance plans by service interval"
              >
                <option value="all">All intervals</option>
                {intervalOptions.map((i) => (
                  <option key={i} value={i}>{i}</option>
                ))}
              </select>
            </>
          )}
        </div>
        <ul className="space-y-0.5 max-h-[420px] overflow-y-auto">
          {filtered.map((w) => (
            <li key={w.name}>
              <button
                onClick={() => selectWiki(w.name)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs font-mono transition ${
                  selected === w.name
                    ? "bg-primary/15 text-primary border border-primary/30"
                    : "hover:bg-muted/40 border border-transparent"
                }`}
              >
                <FileText size={12}/>
                <span className="flex-1 truncate">{w.name}</span>
                {(() => {
                  const md = meta.get(w.name);
                  return md && isMaintenancePlan(md) ? (
                    <span
                      className="shrink-0 rounded bg-primary/10 text-primary px-1 text-[9px] uppercase tracking-wide"
                      title={`Maintenance plan${md.asset ? ` — ${md.asset}` : ""}`}
                    >
                      plan
                    </span>
                  ) : null;
                })()}
              </button>
            </li>
          ))}

          {!filtered.length && (
            <li className="text-[11px] text-muted-foreground italic px-2 py-3 text-center">
              {wikis.length ? "No matches" : "No procedures yet"}
            </li>
          )}
        </ul>
        <p className="text-[10px] text-muted-foreground font-mono px-1 leading-snug">
          Each procedure is a self-contained TinyWiki .html file. Open launches it in a new tab.
        </p>
      </div>

      <div className="flex flex-col gap-2 min-w-0">
        {selected ? (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              {renaming ? (
                <>
                  <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                    className="h-7 font-mono text-xs flex-1 min-w-[160px]" autoFocus
                    onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenaming(false); }}
                  />
                  <Button size="sm" variant="ghost" onClick={commitRename}><Check size={14}/></Button>
                  <Button size="sm" variant="ghost" onClick={() => setRenaming(false)}><X size={14}/></Button>
                </>
              ) : (
                <>
                  <FileText size={14} className="text-muted-foreground"/>
                  <span className="font-mono text-sm flex-1 truncate">{selected}</span>
                  <Button size="sm" variant="ghost" onClick={() => { setRenameValue(selected); setRenaming(true); }} title="Rename">
                    <Pencil size={13}/>
                  </Button>
                </>
              )}
              <Button size="sm" variant="outline" onClick={openInNewTab} title="Open this procedure as HTML in a new tab">
                <ExternalLink size={13}/> Open
              </Button>
              <Button size="sm" variant="outline" onClick={exportOne} title="Export this procedure as TinyWiki .html">
                <Download size={13}/> Export
              </Button>
              <Button size="sm" variant="outline" onClick={tidyNow} title="Tidy: normalize headings, internal link slugs, and whitespace">
                <Wand2 size={13}/> Tidy
              </Button>
              <Button size="sm" variant={dirty ? "default" : "secondary"} onClick={save} disabled={!dirty || saveBodyMut.isPending}>
                <Save size={13}/> Save
              </Button>

              <Button size="sm" variant="ghost" onClick={remove} title="Delete">
                <Trash2 size={13} className="text-destructive"/>
              </Button>
            </div>
            <textarea
              value={content}
              onChange={(e) => { setContent(e.target.value); setDirty(true); }}
              spellCheck
              className="flex-1 min-h-[360px] w-full rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed resize-vertical focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="! Procedure title&#10;&#10;Write TinyWiki markup here…&#10;&#10;!! Section&#10;* step one&#10;* step two"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
              <span>{content.length.toLocaleString()} chars · {content.split(/\s+/).filter(Boolean).length.toLocaleString()} words</span>
              {dirty && <span className="text-amber-500">● unsaved</span>}
            </div>
            <ProcedureLinks procedureName={selected} />
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 text-muted-foreground border border-dashed border-border rounded-md p-8">
            <FileText size={28}/>
            <p className="text-sm">No procedure selected.</p>
            <div className="flex gap-2">
              <Button size="sm" variant="default" onClick={createNew}><Plus size={14}/> New</Button>
              <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                <Upload size={14}/> Import .html
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
