// Utility to open a clean, printable window with custom HTML body content.
// Uses minimal CSS suitable for letter/A4 paper.

export function openPrintWindow(title: string, bodyHtml: string) {
  const win = window.open("", "_blank", "width=900,height=1000");
  if (!win) {
    alert("Pop-ups were blocked. Please allow pop-ups to print.");
    return;
  }
  win.document.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  @page { margin: 0.5in; }
  * { box-sizing: border-box; }
  body {
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #111;
    margin: 0;
    padding: 24px;
    font-size: 12px;
    line-height: 1.4;
  }
  header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 16px; }
  h1 { font-size: 18px; margin: 0; }
  .meta { font-size: 10px; color: #555; }
  h2 { font-size: 14px; margin: 18px 0 8px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  th, td { border: 1px solid #999; padding: 4px 6px; text-align: left; vertical-align: top; font-size: 11px; }
  th { background: #f3f3f3; }
  .grid td { text-align: center; height: 42px; min-width: 60px; font-size: 10px; }
  .grid td.empty { background: #fafafa; color: #bbb; }
  .grid td.filled { background: #f0f7ee; }
  .row-label { background: #f3f3f3 !important; font-weight: 600; }
  .empty-note { padding: 24px; text-align: center; color: #666; border: 1px dashed #bbb; }
  .card { border: 1px solid #999; border-radius: 4px; padding: 8px; margin-bottom: 8px; page-break-inside: avoid; }
  .card .title { font-weight: 600; }
  .badge { display: inline-block; border: 1px solid #999; border-radius: 3px; padding: 1px 6px; font-size: 10px; }
  @media print { .no-print { display: none; } body { padding: 0; } }
</style>
</head>
<body>
${bodyHtml}
<script>window.addEventListener('load', () => setTimeout(() => window.print(), 200));<\/script>
</body>
</html>`);
  win.document.close();
}

export function escapeHtml(s: string | null | undefined): string {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
