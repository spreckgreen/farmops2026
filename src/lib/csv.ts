// Lightweight CSV export utility — ported from Welcoming Pages' inline helpers.
export function escapeCsvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return escapeCsvCell(v.join(";"));
  if (typeof v === "object") return escapeCsvCell(JSON.stringify(v));
  const s = String(v).replace(/"/g, '""');
  return /[",\n]/.test(s) ? `"${s}"` : s;
}

export function rowsToCsv<T extends Record<string, unknown>>(
  rows: T[],
  columns: ReadonlyArray<{ key: keyof T & string; label: string }>,
): string {
  const header = columns.map((c) => escapeCsvCell(c.label)).join(",");
  const body = rows
    .map((r) => columns.map((c) => escapeCsvCell(r[c.key])).join(","))
    .join("\n");
  return header + "\n" + body;
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
