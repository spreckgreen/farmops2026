import { INVENTORY_CSV_COLUMNS, type ParsedRow } from "@/lib/inventory-reconcile";

export const VALID_STATUSES = ["available", "in_use", "maintenance", "retired"] as const;

export type IssueSeverity = "error" | "warning";

export interface RowIssue {
  /** 1-based line number in the file (header is line 1). */
  line: number;
  /** 1-based data row index (first data row = 1). */
  row: number;
  field: string;
  value: string;
  severity: IssueSeverity;
  message: string;
}

export interface ValidationReport {
  issues: RowIssue[];
  errors: RowIssue[];
  warnings: RowIssue[];
  /** Data rows that contain at least one error (1-based row index). */
  badRows: number[];
  /** Rows that were entirely blank and are ignored. */
  blankRows: number;
  totalRows: number;
  validRows: number;
  unknownColumns: string[];
  missingColumns: string[];
  ok: boolean;
}

const KNOWN = new Set<string>(INVENTORY_CSV_COLUMNS);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const str = (v: unknown) => (v == null ? "" : String(v)).trim();

const isBlankRow = (row: Record<string, unknown>) =>
  Object.values(row).every((v) => str(v) === "");

function validateNumber(
  raw: string,
  field: string,
  base: Pick<RowIssue, "line" | "row">,
  push: (i: RowIssue) => void,
) {
  if (raw === "") return;
  const cleaned = raw.replace(/[$,]/g, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) {
    push({
      ...base,
      field,
      value: raw,
      severity: "error",
      message: `"${raw}" is not a number (expected e.g. 12 or 3.5)`,
    });
    return;
  }
  if (n < 0) {
    push({ ...base, field, value: raw, severity: "error", message: "must be 0 or greater" });
    return;
  }
  if (!Number.isInteger(n)) {
    push({
      ...base,
      field,
      value: raw,
      severity: "warning",
      message: "decimal value will be stored as-is",
    });
  }
}

/**
 * Strict validation of parsed inventory CSV rows.
 * Errors block the import; warnings are informational.
 */
export function validateInventoryCsv(
  rows: Array<Record<string, unknown>>,
  options: { headers?: string[]; knownIds?: Iterable<string> } = {},
): ValidationReport {
  const issues: RowIssue[] = [];
  const push = (i: RowIssue) => issues.push(i);

  const headers = (options.headers ?? Object.keys(rows[0] ?? {})).map((h) =>
    h.trim().toLowerCase(),
  );
  const unknownColumns = headers.filter((h) => h !== "" && !KNOWN.has(h));
  const missingColumns = headers.length > 0 && !headers.includes("name") ? ["name"] : [];
  const knownIds = new Set(options.knownIds ?? []);

  const seenIds = new Map<string, number>();
  const seenBarcodes = new Map<string, number>();
  const seenNames = new Map<string, number>();

  let blankRows = 0;
  const badRows = new Set<number>();
  let dataRow = 0;

  rows.forEach((raw, idx) => {
    if (isBlankRow(raw)) {
      blankRows += 1;
      return;
    }
    dataRow += 1;
    const base = { line: idx + 2, row: dataRow };
    const before = issues.length;
    const row = raw as ParsedRow;

    const name = str(row.name);
    if (!name) {
      push({ ...base, field: "name", value: "", severity: "error", message: "name is required" });
    } else if (name.length > 200) {
      push({
        ...base,
        field: "name",
        value: name,
        severity: "error",
        message: `name is ${name.length} characters (max 200)`,
      });
    }

    const id = str(row.id);
    if (id) {
      if (!UUID_RE.test(id)) {
        push({
          ...base,
          field: "id",
          value: id,
          severity: "error",
          message: "id must be a UUID copied from an export, or left blank for new items",
        });
      } else if (knownIds.size > 0 && !knownIds.has(id)) {
        push({
          ...base,
          field: "id",
          value: id,
          severity: "warning",
          message: "id not found in current inventory — row will be treated as new",
        });
      }
      const dupe = seenIds.get(id.toLowerCase());
      if (dupe) {
        push({
          ...base,
          field: "id",
          value: id,
          severity: "error",
          message: `duplicate id, already used on row ${dupe}`,
        });
      } else seenIds.set(id.toLowerCase(), dataRow);
    }

    const status = str(row.status).toLowerCase();
    if (status && !VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
      push({
        ...base,
        field: "status",
        value: str(row.status),
        severity: "error",
        message: `invalid status (use ${VALID_STATUSES.join(", ")})`,
      });
    }

    validateNumber(str(row.quantity), "quantity", base, push);
    validateNumber(str(row.min_quantity), "min_quantity", base, push);

    const barcode = str(row.barcode);
    if (barcode) {
      const key = barcode.toLowerCase();
      const dupe = seenBarcodes.get(key);
      if (dupe) {
        push({
          ...base,
          field: "barcode",
          value: barcode,
          severity: "error",
          message: `duplicate barcode, already used on row ${dupe}`,
        });
      } else seenBarcodes.set(key, dataRow);
    }

    if (name) {
      const key = name.toLowerCase();
      const dupe = seenNames.get(key);
      if (dupe && !id) {
        push({
          ...base,
          field: "name",
          value: name,
          severity: "warning",
          message: `same name as row ${dupe} — this will create a second item`,
        });
      } else if (!dupe) seenNames.set(key, dataRow);
    }

    const tags = str(row.tags);
    if (tags.includes(",")) {
      push({
        ...base,
        field: "tags",
        value: tags,
        severity: "warning",
        message: 'separate tags with ";" (e.g. tractor;diesel) — commas stay part of the tag',
      });
    }

    for (const col of unknownColumns) {
      if (str(raw[col]) !== "") {
        push({
          ...base,
          field: col,
          value: str(raw[col]),
          severity: "warning",
          message: "unrecognized column — this value is ignored on import",
        });
      }
    }

    if (issues.slice(before).some((i) => i.severity === "error")) badRows.add(dataRow);
  });

  if (missingColumns.length) {
    push({
      line: 1,
      row: 0,
      field: "name",
      value: "",
      severity: "error",
      message: "the file has no name column — re-export from Inventory and edit that file",
    });
  }

  const errors = issues.filter((i) => i.severity === "error");
  return {
    issues,
    errors,
    warnings: issues.filter((i) => i.severity === "warning"),
    badRows: [...badRows].sort((a, b) => a - b),
    blankRows,
    totalRows: dataRow,
    validRows: dataRow - badRows.size,
    unknownColumns,
    missingColumns,
    ok: errors.length === 0,
  };
}
