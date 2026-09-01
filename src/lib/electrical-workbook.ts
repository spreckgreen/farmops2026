// Pure, client-safe builder for the electrician's workbook snapshot.
//
// It is a *view* over the authoritative electrical records: it reads nothing,
// writes nothing, and never touches the canonical PremoFarmElectrical.ods.
// Deterministic — identical data yields identical sections.
import { ENTITIES, ENTITY_KINDS, type EntityField } from "@/lib/electrical-entities";
import { installStatusLabel, ODS_EXTRAS_FIELD, type ElectricalEntityKind } from "@/lib/electrical";

export type WorkbookRow = Record<string, unknown>;

export interface WorkbookColumn {
  key: string;
  label: string;
}

export interface WorkbookSection {
  key: string;
  title: string;
  description: string;
  columns: WorkbookColumn[];
  rows: string[][];
  /** Total records, even when a row rendered as blank. */
  count: number;
}

export interface WorkbookDiagram {
  key: string;
  title: string;
  mermaid: string;
}

export interface WorkbookInput {
  generatedAt: string;
  /** Rows per entity kind, already carrying `stable_id` / `*_stable_id` pairs. */
  entities: Partial<Record<ElectricalEntityKind, WorkbookRow[]>>;
  services?: {
    services: WorkbookRow[];
    configs: WorkbookRow[];
    interties: WorkbookRow[];
  };
  standards?: WorkbookRow[];
}

export interface Workbook {
  generated_at: string;
  title: string;
  sections: WorkbookSection[];
  total_records: number;
}

export const WORKBOOK_TITLE = "Bostead Farms — Electrical Field Workbook";

/** Max columns kept per section so the printed page and DOCX stay readable. */
const MAX_COLUMNS = 9;

function isSkipped(field: EntityField): boolean {
  return field.key === ODS_EXTRAS_FIELD || field.kind === "asset";
}

/** Snapshot column that carries the human-readable target of an FK column. */
function stableIdColumn(key: string): string {
  return key.replace(/_uuid$/, "_stable_id");
}

export function workbookColumns(kind: ElectricalEntityKind): WorkbookColumn[] {
  const def = ENTITIES[kind];
  const columns: WorkbookColumn[] = [{ key: "stable_id", label: def.stableIdLabel }];
  const candidates = def.fields.filter((f) => !isSkipped(f));
  const primary = candidates.filter((f) => f.list || f.field);
  const chosen = primary.length ? primary : candidates;
  for (const field of chosen) {
    if (columns.length >= MAX_COLUMNS) break;
    const key = field.kind === "entity" ? stableIdColumn(field.key) : field.key;
    if (columns.some((c) => c.key === key)) continue;
    columns.push({ key, label: field.label.replace(/\s*\(superseded\)$/, "") });
  }
  return columns;
}

export function formatCell(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (key === "install_status") return installStatusLabel(String(value));
  if (key === "completion_percent") return `${Number(value)}%`;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text === "" ? "—" : text;
}

function sortRows(rows: WorkbookRow[]): WorkbookRow[] {
  return [...rows].sort((a, b) => {
    const sa = String(a["stable_id"] ?? "");
    const sb = String(b["stable_id"] ?? "");
    if (sa !== sb) return sa.localeCompare(sb);
    return String(a["uuid"] ?? a["id"] ?? "").localeCompare(String(b["uuid"] ?? b["id"] ?? ""));
  });
}

function entitySection(kind: ElectricalEntityKind, rows: WorkbookRow[]): WorkbookSection {
  const def = ENTITIES[kind];
  const columns = workbookColumns(kind);
  return {
    key: kind,
    title: def.title,
    description: `As-installed ${def.title.toLowerCase()} with stable IDs, field status and topology links.`,
    columns,
    rows: sortRows(rows).map((row) => columns.map((c) => formatCell(c.key, row[c.key]))),
    count: rows.length,
  };
}

function servicesSection(input: NonNullable<WorkbookInput["services"]>): WorkbookSection[] {
  const columns: WorkbookColumn[] = [
    { key: "service_id", label: "Service ID" },
    { key: "description", label: "Description" },
    { key: "lifecycle_state", label: "Lifecycle" },
    { key: "utility", label: "Utility" },
    { key: "notes", label: "Notes" },
  ];
  const configColumns: WorkbookColumn[] = [
    { key: "service_id", label: "Service ID" },
    { key: "revision", label: "Revision" },
    { key: "lifecycle_state", label: "State" },
    { key: "service_amps", label: "Amps" },
    { key: "service_voltage", label: "Voltage" },
    { key: "meter_number", label: "Meter" },
    { key: "effective_date", label: "Effective" },
  ];
  const intertieColumns: WorkbookColumn[] = [
    { key: "intertie_id", label: "Intertie ID" },
    { key: "description", label: "Description" },
    { key: "lifecycle_state", label: "Lifecycle" },
    { key: "notes", label: "Notes" },
  ];
  const rowsFor = (rows: WorkbookRow[], cols: WorkbookColumn[], idKey: string) =>
    [...rows]
      .sort((a, b) => String(a[idKey] ?? "").localeCompare(String(b[idKey] ?? "")))
      .map((row) => cols.map((c) => formatCell(c.key, row[c.key])));

  return [
    {
      key: "services",
      title: "Utility services",
      description:
        "Permanent service identity. Ampacity, voltage and meter live on the configuration revisions below, never in the service name.",
      columns,
      rows: rowsFor(input.services, columns, "service_id"),
      count: input.services.length,
    },
    {
      key: "service_configurations",
      title: "Service configurations",
      description: "Configuration revisions per service, including commissioned state.",
      columns: configColumns,
      rows: rowsFor(input.configs, configColumns, "service_id"),
      count: input.configs.length,
    },
    {
      key: "interties",
      title: "Interties",
      description: "Interties between services and panels.",
      columns: intertieColumns,
      rows: rowsFor(input.interties, intertieColumns, "intertie_id"),
      count: input.interties.length,
    },
  ];
}

function standardsSection(rows: WorkbookRow[]): WorkbookSection {
  const columns: WorkbookColumn[] = [
    { key: "key", label: "Standard" },
    { key: "title", label: "Title" },
    { key: "value", label: "Convention" },
    { key: "notes", label: "Notes" },
  ];
  return {
    key: "standards",
    title: "Naming standards & conventions",
    description:
      "Stable ID formats and field conventions. Stable IDs are permanent: never rename or renumber a record.",
    columns,
    rows: [...rows]
      .sort((a, b) => String(a["key"] ?? "").localeCompare(String(b["key"] ?? "")))
      .map((row) => columns.map((c) => formatCell(c.key, row[c.key]))),
    count: rows.length,
  };
}

export function buildWorkbook(input: WorkbookInput): Workbook {
  const sections: WorkbookSection[] = [];
  for (const kind of ENTITY_KINDS) {
    sections.push(entitySection(kind, input.entities[kind] ?? []));
  }
  if (input.services) sections.push(...servicesSection(input.services));
  if (input.standards) sections.push(standardsSection(input.standards));
  return {
    generated_at: input.generatedAt,
    title: WORKBOOK_TITLE,
    sections,
    total_records: sections.reduce((sum, s) => sum + s.count, 0),
  };
}

export function workbookFilename(generatedAt: string, ext: string): string {
  const stamp = generatedAt.replace(/[:.]/g, "").replace(/Z$/, "");
  return `bostead-electrical-workbook-${stamp}.${ext}`;
}
