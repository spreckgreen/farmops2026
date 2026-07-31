// Browser-side parsing of arbitrary data exports into flat KB source items.
// Runs entirely client-side so the Worker/server runtime never needs binary
// document libraries (pdfjs, mammoth) or zip inflation.

export type SourceKind = "chatgpt" | "markdown" | "record" | "pdf" | "docx";

export interface SourceItem {
  id: string;
  title: string;
  kind: SourceKind;
  text: string;
}

export interface ParseResult {
  items: SourceItem[];
  skipped: { name: string; reason: string }[];
}

/** Hard caps so a huge export can't be pushed at the model in one go. */
export const MAX_ITEMS = 60;
export const MAX_ITEM_CHARS = 12_000;
export const MIN_ITEM_CHARS = 40;

let seq = 0;
function nextId(): string {
  seq += 1;
  return `s${seq}`;
}

function clean(s: string): string {
  return String(s ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function makeItem(
  title: string,
  kind: SourceKind,
  text: string,
): SourceItem | null {
  const body = clean(text).slice(0, MAX_ITEM_CHARS);
  if (body.length < MIN_ITEM_CHARS) return null;
  return {
    id: nextId(),
    title: (title || "Untitled").trim().slice(0, 160),
    kind,
    text: body,
  };
}

// --- CSV (minimal RFC4180 reader) ------------------------------------------

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ",") { row.push(cell); cell = ""; continue; }
    if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
    cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim().length));
}

function itemsFromCsv(name: string, text: string): SourceItem[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim() || "col");
  const titleIdx = header.findIndex((h) => /^(title|name|subject|question)$/i.test(h));
  const out: SourceItem[] = [];
  for (const r of rows.slice(1)) {
    const lines = header.map((h, i) => `${h}: ${r[i] ?? ""}`).join("\n");
    const title = titleIdx >= 0 && r[titleIdx] ? r[titleIdx] : `${name} row ${out.length + 1}`;
    const item = makeItem(title, "record", lines);
    if (item) out.push(item);
  }
  return out;
}

// --- JSON ------------------------------------------------------------------

function isChatGptExport(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    typeof value[0] === "object" &&
    value[0] !== null &&
    "mapping" in (value[0] as Record<string, unknown>)
  );
}

type GptNode = {
  message?: {
    author?: { role?: string };
    content?: { parts?: unknown[]; text?: string };
    create_time?: number;
  } | null;
};

/** Walk a ChatGPT conversation `mapping` into a readable transcript. */
function chatGptTranscript(conv: Record<string, unknown>): string {
  const mapping = (conv.mapping ?? {}) as Record<string, GptNode>;
  const nodes = Object.values(mapping)
    .filter((n) => n?.message)
    .sort(
      (a, b) =>
        (a.message?.create_time ?? 0) - (b.message?.create_time ?? 0),
    );
  const lines: string[] = [];
  for (const n of nodes) {
    const role = n.message?.author?.role ?? "user";
    if (role === "system" || role === "tool") continue;
    const parts = n.message?.content?.parts;
    const raw = Array.isArray(parts)
      ? parts.map((p) => (typeof p === "string" ? p : "")).join("\n")
      : (n.message?.content?.text ?? "");
    const body = clean(raw);
    if (!body) continue;
    lines.push(`${role === "assistant" ? "Assistant" : "User"}: ${body}`);
  }
  return lines.join("\n\n");
}

function itemsFromJson(name: string, text: string): SourceItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }

  if (isChatGptExport(parsed)) {
    const out: SourceItem[] = [];
    for (const conv of parsed as Record<string, unknown>[]) {
      const item = makeItem(
        String(conv.title ?? "Conversation"),
        "chatgpt",
        chatGptTranscript(conv),
      );
      if (item) out.push(item);
    }
    return out;
  }

  const arr = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? [parsed]
      : [];
  const out: SourceItem[] = [];
  for (const rec of arr) {
    if (rec && typeof rec === "object") {
      const r = rec as Record<string, unknown>;
      const title =
        String(r.title ?? r.name ?? r.subject ?? "") ||
        `${name} record ${out.length + 1}`;
      const body = Object.entries(r)
        .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
        .join("\n");
      const item = makeItem(title, "record", body);
      if (item) out.push(item);
    } else {
      const item = makeItem(`${name} record ${out.length + 1}`, "record", String(rec));
      if (item) out.push(item);
    }
  }
  return out;
}

// --- Binary docs -----------------------------------------------------------

async function pdfToText(buf: ArrayBuffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (
    await import("pdfjs-dist/build/pdf.worker.min.mjs?url")
  ).default as string;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const pages: string[] = [];
  const max = Math.min(doc.numPages, 50);
  for (let p = 1; p <= max; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    pages.push(
      content.items
        .map((it) => ("str" in it ? (it as { str: string }).str : ""))
        .join(" "),
    );
  }
  return pages.join("\n\n");
}

async function docxToText(buf: ArrayBuffer): Promise<string> {
  const mammoth = await import("mammoth");
  const res = await mammoth.extractRawText({ arrayBuffer: buf });
  return res.value;
}

// --- Entry point -----------------------------------------------------------

function baseName(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim();
}

async function parseNamedBytes(
  name: string,
  bytes: ArrayBuffer,
  out: ParseResult,
): Promise<void> {
  const lower = name.toLowerCase();
  const push = (items: SourceItem[]) => {
    if (!items.length) out.skipped.push({ name, reason: "no usable text" });
    out.items.push(...items);
  };

  try {
    if (lower.endsWith(".pdf")) {
      const item = makeItem(baseName(name), "pdf", await pdfToText(bytes));
      push(item ? [item] : []);
      return;
    }
    if (lower.endsWith(".docx")) {
      const item = makeItem(baseName(name), "docx", await docxToText(bytes));
      push(item ? [item] : []);
      return;
    }

    const text = new TextDecoder().decode(bytes);
    if (lower.endsWith(".json")) { push(itemsFromJson(baseName(name), text)); return; }
    if (lower.endsWith(".csv")) { push(itemsFromCsv(baseName(name), text)); return; }
    if (/\.(md|markdown|txt|log|html?)$/i.test(lower)) {
      const item = makeItem(baseName(name), "markdown", text);
      push(item ? [item] : []);
      return;
    }
    out.skipped.push({ name, reason: "unsupported file type" });
  } catch (e) {
    out.skipped.push({
      name,
      reason: e instanceof Error ? e.message : "could not be read",
    });
  }
}

/** Parse a user file selection into flat source items. */
export async function parseExportFiles(files: File[]): Promise<ParseResult> {
  const out: ParseResult = { items: [], skipped: [] };

  for (const file of files) {
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".zip")) {
      try {
        const { unzipSync } = await import("fflate");
        const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
        for (const [entryName, bytes] of Object.entries(entries)) {
          if (!bytes.length || entryName.endsWith("/")) continue;
          if (/(^|\/)__MACOSX|\.DS_Store$/i.test(entryName)) continue;
          if (!/\.(json|csv|md|markdown|txt|log|html?|pdf|docx)$/i.test(entryName)) {
            continue;
          }
          const copy = bytes.slice();
          await parseNamedBytes(
            entryName,
            copy.buffer.slice(
              copy.byteOffset,
              copy.byteOffset + copy.byteLength,
            ) as ArrayBuffer,
            out,
          );
        }
      } catch (e) {
        out.skipped.push({
          name: file.name,
          reason: e instanceof Error ? e.message : "zip could not be read",
        });
      }
      continue;
    }
    await parseNamedBytes(file.name, await file.arrayBuffer(), out);
  }

  if (out.items.length > MAX_ITEMS) {
    for (const extra of out.items.slice(MAX_ITEMS)) {
      out.skipped.push({ name: extra.title, reason: `over the ${MAX_ITEMS}-item per-run cap` });
    }
    out.items = out.items.slice(0, MAX_ITEMS);
  }
  return out;
}

export const KIND_LABEL: Record<SourceKind, string> = {
  chatgpt: "ChatGPT chat",
  markdown: "Text / Markdown",
  record: "Record",
  pdf: "PDF",
  docx: "Word doc",
};
