// Pure helpers for building, parsing, and validating self-contained
// TinyWiki / TiddlyWiki HTML documents used by the Procedures pane.
// No storage I/O — persistence happens via server functions.

const MAX_NAME_LEN = 120;
const DISALLOWED_CHARS = /[\/\\<>:"|?*\x00-\x1f]/;

export function validateWikiName(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) throw new Error("Name is required.");
  if (cleaned.length > MAX_NAME_LEN) throw new Error(`Name must be ${MAX_NAME_LEN} characters or fewer.`);
  if (DISALLOWED_CHARS.test(cleaned)) throw new Error('Name cannot contain: / \\ < > : " | ? * or control characters.');
  if (cleaned.startsWith(".") || cleaned.endsWith(".")) throw new Error("Name cannot start or end with a dot.");
  return cleaned;
}

function escAttr(s: string) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escPre(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function tiddlyTimestamp(d = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}${p(d.getUTCMilliseconds(), 3)}`;
}

export function isTinyWikiHtml(s: string): boolean {
  return /<div\s+id=["']storeArea["']/i.test(s);
}

/**
 * Render TinyWiki markup to plain readable HTML.
 *
 * Pure and dependency-free so the same output can be embedded in an exported
 * file. Exported documents render with JavaScript disabled, which is what makes
 * them open reliably in Chrome (blob:/file: pages inherit strict CSP and can
 * silently block inline scripts, leaving a blank page).
 */
export function renderWikiToHtml(text: string): string {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/&[a-z]+;/g, " ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);

  // Protect code fences before escaping / inline processing.
  const fences: string[] = [];
  let src = (text ?? "").replace(/\r\n?/g, "\n").replace(
    /^\{\{\{\n([\s\S]*?)\n\}\}\}$/gm,
    (_m, code: string) => {
      fences.push(code);
      return `\u0000FENCE${fences.length - 1}\u0000`;
    },
  );

  let html = escPre(src)
    .replace(/^!{4,} (.*)$/gim, (_m, s: string) => `<h4 id="${slug(s)}">${s}</h4>`)
    .replace(/^!!! (.*)$/gim, (_m, s: string) => `<h3 id="${slug(s)}">${s}</h3>`)
    .replace(/^!! (.*)$/gim, (_m, s: string) => `<h2 id="${slug(s)}">${s}</h2>`)
    .replace(/^! (.*)$/gim, (_m, s: string) => `<h1 id="${slug(s)}">${s}</h1>`)
    .replace(/^----+\s*$/gim, "<hr>")
    .replace(/''(.*?)''/g, "<strong>$1</strong>")
    .replace(/\/\/(.*?)\/\//g, "<em>$1</em>")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_m, label: string, target: string) =>
      /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|mailto:)/i.test(target)
        ? `<a href="${escAttr(target)}"${target.startsWith("#") ? "" : ' target="_blank" rel="noopener"'}>${label}</a>`
        : `<span class="tw-link">${label}</span>`,
    )
    .replace(/\[\[([^\]]+)\]\]/g, (_m, t: string) => `<span class="tw-link">${t}</span>`)
    .replace(/^\*\* (.*)$/gim, '<li class="lvl2">$1</li>')
    .replace(/^\* (.*)$/gim, "<li>$1</li>")
    .replace(/^# (.*)$/gim, "<li>$1</li>")
    .replace(/^\|(.+)\|\s*$/gim, (_m, cells: string) => {
      const tds = cells.split("|").map((c) => {
        const t = c.trim();
        return t.startsWith("!") ? `<th>${t.slice(1).trim()}</th>` : `<td>${t}</td>`;
      });
      return `<tr>${tds.join("")}</tr>`;
    });

  html = html.replace(/(?:<li(?: class="lvl2")?>[\s\S]*?<\/li>\n?)+/g, (m) => `<ul>\n${m}</ul>`);
  html = html.replace(/(?:<tr>[\s\S]*?<\/tr>\n?)+/g, (m) => `<table>\n${m}</table>`);
  html = html
    .split("\n\n")
    .map((b) => {
      const t = b.trim();
      if (!t) return "";
      if (t.startsWith("<")) return t;
      return `<p>${t.replace(/\n/g, "<br>")}</p>`;
    })
    .filter(Boolean)
    .join("\n");

  return html.replace(/\u0000FENCE(\d+)\u0000/g, (_m, i) => `<pre class="tw-code">${escPre(fences[Number(i)])}</pre>`);
}

const EXPORT_CSS = `:root{color-scheme:light}
body{margin:0;background:#fff;color:#222}
main{font-family:Georgia,'Times New Roman',serif;max-width:820px;margin:2em auto;padding:0 1.25em;line-height:1.6}
h1{font-size:1.9em;border-bottom:1px solid #ddd;padding-bottom:.3em}
h2{font-size:1.35em;margin-top:1.8em}
h3{font-size:1.1em;margin-top:1.4em}
ul{padding-left:1.4em}li.lvl2{margin-left:1.4em}
table{border-collapse:collapse;margin:1em 0;width:100%}
th,td{border:1px solid #bbb;padding:.4em .6em;text-align:left;vertical-align:top}
th{background:#f2f2f2}
pre.tw-code{background:#f6f6f6;border:1px solid #e0e0e0;padding:.75em;overflow:auto;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.9em}
.tw-link{border-bottom:1px dotted #888}
hr{border:0;border-top:1px solid #ddd;margin:2em 0}
@media print{main{margin:0;max-width:none}}`;

/** Build a complete TinyWiki HTML document with `body` as the main tiddler.
 *  The document renders statically (no JavaScript needed) and still keeps the
 *  hidden storeArea so it can be re-imported into Bostead or TiddlyWiki. */
export function buildTinyWikiHtml(name: string, body: string): string {
  const ts = tiddlyTimestamp();
  const titleAttr = escAttr(name);
  const safeBody = escPre(body);
  const rendered = renderWikiToHtml(body);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="application-name" content="TiddlyWiki" />
<meta name="generator" content="TiddlyWiki" />
<meta name="tiddlywiki-version" content="5.1.23" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escAttr(name)} — Procedure</title>
<style>${EXPORT_CSS}</style>
</head>
<body class="tc-body">
<div id="storeArea" style="display:none;">
<div title="$:/SiteTitle"><pre>${escPre(name)}</pre></div>
<div created="${ts}" list="${titleAttr}" modified="${ts}" title="$:/StoryList"><pre></pre></div>
<div created="${ts}" modified="${ts}" tags="" title="${titleAttr}">
<pre>${safeBody}</pre>
</div>
<div title="$:/isEncrypted"><pre>no</pre></div>
</div><!-- end storeArea -->
<main class="tc-tiddler">
${rendered}
</main>
</body>
</html>`;
}


/** Pull the main tiddler body (wiki markup) out of a TinyWiki HTML doc. */
export function extractBodyWiki(html: string, preferredTitle?: string): string {
  if (typeof DOMParser === "undefined") return "";
  if (!isTinyWikiHtml(html)) return html;
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const store = doc.getElementById("storeArea");
    if (!store) return "";
    const divs = Array.from(store.querySelectorAll("div[title]"));
    let pick = preferredTitle ? divs.find((d) => d.getAttribute("title") === preferredTitle) : undefined;
    if (!pick) {
      pick = divs.find((d) => {
        const t = d.getAttribute("title") || "";
        const ty = d.getAttribute("type") || "";
        return !t.startsWith("$:/") && !ty.startsWith("image/");
      });
    }
    const pre = pick?.querySelector("pre");
    return pre?.textContent ?? "";
  } catch {
    return "";
  }
}

/**
 * Verify a string is a well-formed TinyWiki HTML document.
 * Browser-only (needs DOMParser); on the server, callers should skip validation.
 */
export function validateTinyWikiHtml(html: string): void {
  if (typeof html !== "string" || !html.trim()) {
    throw new Error("File is empty.");
  }
  if (!isTinyWikiHtml(html)) {
    throw new Error('Not a TinyWiki file: missing <div id="storeArea">.');
  }
  if (typeof DOMParser === "undefined") return;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    throw new Error("File could not be parsed as HTML.");
  }
  if (!doc.documentElement || doc.documentElement.tagName.toLowerCase() !== "html") {
    throw new Error("File does not contain a valid <html> root element.");
  }
  const store = doc.getElementById("storeArea");
  if (!store || store.tagName.toLowerCase() !== "div") {
    throw new Error('TinyWiki structure invalid: <div id="storeArea"> not found after parsing.');
  }
  const tiddlers = Array.from(store.children).filter(
    (el) => el.tagName.toLowerCase() === "div" && el.hasAttribute("title"),
  );
  if (!tiddlers.length) {
    throw new Error('TinyWiki structure invalid: storeArea contains no <div title="…"> tiddlers.');
  }
  const valid = tiddlers.filter((d) => {
    const title = d.getAttribute("title");
    if (!title || !title.trim()) return false;
    const pres = Array.from(d.children).filter((c) => c.tagName.toLowerCase() === "pre");
    if (pres.length !== 1) return false;
    return (pres[0].textContent ?? "").trim().length > 0;
  });
  if (!valid.length) {
    throw new Error('TinyWiki structure invalid: no tiddler has the required <div title="…"><pre>…</pre></div> structure with non-empty content.');
  }
  const content = valid.find((d) => {
    const t = d.getAttribute("title") || "";
    const ty = d.getAttribute("type") || "";
    return !t.startsWith("$:/") && !ty.startsWith("image/");
  });
  if (!content) {
    throw new Error("TinyWiki structure invalid: no content tiddler (only system/image tiddlers found).");
  }
}

export function filenameForExport(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9._-]+/g, "_");
  return `${safe}.html`;
}

export function nameFromFilename(filename: string): string {
  const base = filename.replace(/\.(html?|md|markdown|txt)$/i, "").trim();
  if (!base) throw new Error(`Invalid filename: "${filename}" has no usable name after stripping the extension.`);
  return base;
}
