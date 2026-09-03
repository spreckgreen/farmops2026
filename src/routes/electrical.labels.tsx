// Field labels for the whole electrical record: print QR labels for panels,
// conduits, junction boxes, feeders, branch runs, loads, circuit groups,
// equipment racks, power assets and powered devices — one type at a time, or a
// print group covering several types in one job — and scan a label with the
// device camera to open that record.
import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Camera, CameraOff, Printer, QrCode, Search } from "lucide-react";

import { ElectricalGate } from "@/components/electrical/electrical-gate";
import {
  LABEL_FORMATS,
  LABEL_FORMAT_LIST,
  PanelQrLabel,
  labelPrintCss,
  type LabelFormat,
} from "@/components/electrical/panel-qr-label";
import { EntityQrLabel } from "@/components/electrical/entity-qr-label";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { listElectricalLabels } from "@/lib/electrical-labels.functions";
import {
  LABEL_KINDS,
  PRINT_GROUPS,
  filterLabelRecords,
  locationOptions,
  panelOptions,
  labelWalkGroups,
  sortLabelRecords,

  type LabelKind,
  type LabelRecord,
  type LabelScopeMode,
} from "@/lib/electrical-labels";
import { ENTITIES } from "@/lib/electrical-entities";
import { parsePanelQr } from "@/lib/electrical-panel-access";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/electrical/labels")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  component: PanelLabelsPage,
  head: () => ({
    meta: [
      { title: "Electrical QR Labels — Bostead Farms" },
      {
        name: "description",
        content:
          "Print scannable QR labels for panels, conduits, junction boxes, branch runs, loads, racks and powered devices, and scan one in the field to open its record.",
      },
      { property: "og:title", content: "Electrical QR Labels — Bostead Farms" },
      {
        property: "og:description",
        content:
          "Printable label sheets and label-printer stock for every electrical record, with QR codes that open the live record.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function QrScanner({ onPanel }: { onPanel: (panelId: string) => void }) {
  const containerId = "panel-qr-scanner";
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        const scanner = new Html5Qrcode(containerId);
        scannerRef.current = scanner as unknown as { stop: () => Promise<void>; clear: () => void };
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decoded: string) => {
            const panelId = parsePanelQr(decoded);
            const item = decoded.match(/\/electrical\/item\/([a-z_]+)\/([^/?#\s]+)/i);
            if (!panelId && !item) {
              setError(`That code isn't an electrical label: ${decoded.slice(0, 60)}`);
              return;
            }
            void scanner.stop().then(() => scanner.clear()).catch(() => undefined);
            setActive(false);
            if (item) {
              window.location.assign(`/electrical/item/${item[1]!.toLowerCase()}/${item[2]}`);
              return;
            }
            onPanel(panelId!);
          },
          () => undefined,
        );
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error
              ? `Camera unavailable: ${e.message}`
              : "Camera unavailable on this device.",
          );
          setActive(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      const s = scannerRef.current;
      scannerRef.current = null;
      if (s) void s.stop().then(() => s.clear()).catch(() => undefined);
    };
  }, [active, onPanel]);

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button size="sm" variant={active ? "secondary" : "outline"} onClick={() => setActive(!active)}>
          {active ? (
            <>
              <CameraOff className="mr-1 h-4 w-4" /> Stop camera
            </>
          ) : (
            <>
              <Camera className="mr-1 h-4 w-4" /> Scan a label
            </>
          )}
        </Button>
      </div>
      <div id={containerId} className={active ? "overflow-hidden rounded-md border" : "hidden"} />
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function gridClass(format: LabelFormat): string {
  if (format === "avery-8593") return "panel-label-grid grid gap-2 sm:grid-cols-3";
  if (format === "letter-4x2") return "panel-label-grid grid gap-3 sm:grid-cols-2 lg:grid-cols-4";
  if (format === "letter-2x5")
    return "panel-label-grid grid gap-3 sm:grid-cols-3 lg:grid-cols-5";
  return "panel-label-grid grid grid-cols-1 gap-4 sm:max-w-sm";
}

function paperNote(format: LabelFormat): string {
  switch (format) {
    case "label-7676":
      return '2.99" x 2.99" label stock';
    case "avery-8593":
      return 'Avery 8593 file-folder label sheets (8.5" x 11")';
    default:
      return '8.5" x 11" letter';
  }
}

function PanelLabelsPage() {
  const navigate = useNavigate();
  const fetchLabels = useServerFn(listElectricalLabels);

  // Selection: one label type, or a print group covering several types.
  const [selection, setSelection] = useState<string>("type:panel");
  const [format, setFormat] = useState<LabelFormat>("letter-2x5");
  const [scopeMode, setScopeMode] = useState<LabelScopeMode>("all");
  const [scopeValue, setScopeValue] = useState<string>("");
  const [filter, setFilter] = useState("");
  const [manual, setManual] = useState("");
  // Shortened stock is tiny, so the in-cell QR is opt-in.
  const [shortQr, setShortQr] = useState(true);

  const kinds: LabelKind[] = useMemo(() => {
    if (selection.startsWith("group:")) {
      const group = PRINT_GROUPS.find((g) => g.id === selection.slice(6));
      return group ? group.kinds : ["panel"];
    }
    return [selection.slice(5) as LabelKind];
  }, [selection]);

  const labels = useQuery({
    queryKey: ["electrical-labels", kinds.join("+")],
    queryFn: () => fetchLabels({ data: { kinds } }),
  });

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const all: LabelRecord[] = labels.data ?? [];

  const panels = useMemo(() => panelOptions(all), [all]);
  const locations = useMemo(() => locationOptions(all), [all]);

  // Records to print, split per kind and ordered panel → walk order → ID.
  const sections = useMemo(() => {
    const scoped = filterLabelRecords(all, { mode: scopeMode, value: scopeValue }, filter);
    return kinds
      .map((kind) => ({
        kind,
        records: sortLabelRecords(scoped.filter((r) => r.kind === kind)),
      }))
      .filter((s) => s.records.length > 0 || kinds.length === 1);
  }, [all, kinds, scopeMode, scopeValue, filter]);

  const total = sections.reduce((n, s) => n + s.records.length, 0);
  const perPage = LABEL_FORMATS[format].perPage;
  // Each kind starts a new sheet; shortened stock also breaks at every location
  // and panel change, so those blocks are counted separately.
  const pages = sections.reduce(
    (n, s) =>
      n +
      (LABEL_FORMATS[format].short
        ? labelWalkGroups(s.records).reduce(
            (m, g) => m + Math.ceil(g.records.length / perPage),
            0,
          )
        : Math.ceil(s.records.length / perPage)),
    0,
  );


  const openPanel = (panelId: string) =>
    navigate({ to: "/electrical/panel/$panelId", params: { panelId } });

  return (
    <ElectricalGate>
      <div className="space-y-4">
        <Card className="print:hidden">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <QrCode className="h-4 w-4" /> Electrical labels
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Every label's QR opens that record. Panel labels open the read-only panel sheet, where
              an electrician can request a temporary edit window; all other labels open the record's
              detail page. Stable IDs on labels are permanent — printing never changes one.
            </p>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1">
                <Label htmlFor="label-type">Label type or print group</Label>
                <Select
                  value={selection}
                  onValueChange={(v) => {
                    setSelection(v);
                    setScopeMode("all");
                    setScopeValue("");
                  }}
                >
                  <SelectTrigger id="label-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LABEL_KINDS.map((k) => (
                      <SelectItem key={k} value={`type:${k}`}>
                        {ENTITIES[k].title}
                      </SelectItem>
                    ))}
                    {PRINT_GROUPS.map((g) => (
                      <SelectItem key={g.id} value={`group:${g.id}`}>
                        Group · {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label htmlFor="label-size">Print format</Label>
                <Select value={format} onValueChange={(v) => setFormat(v as LabelFormat)}>
                  <SelectTrigger id="label-size">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LABEL_FORMAT_LIST.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {LABEL_FORMATS[format].short ? (
                  <div className="flex items-center gap-2 pt-1">
                    <Switch id="short-qr" checked={shortQr} onCheckedChange={setShortQr} />
                    <Label htmlFor="short-qr" className="text-xs font-normal">
                      Include small QR (opens the item in the app)
                    </Label>
                  </div>
                ) : null}
              </div>

              <div className="space-y-1">
                <Label htmlFor="label-scope">Print scope</Label>
                <Select
                  value={scopeMode}
                  onValueChange={(v) => {
                    setScopeMode(v as LabelScopeMode);
                    setScopeValue("");
                  }}
                >
                  <SelectTrigger id="label-scope">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All records</SelectItem>
                    <SelectItem value="panel">One panel</SelectItem>
                    <SelectItem value="location">One location</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label htmlFor="scope-value">
                  {scopeMode === "location" ? "Location" : "Panel"}
                </Label>
                <Select
                  value={scopeValue}
                  onValueChange={setScopeValue}
                  disabled={scopeMode === "all"}
                >
                  <SelectTrigger id="scope-value">
                    <SelectValue
                      placeholder={scopeMode === "all" ? "Not scoped" : "Choose one…"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {(scopeMode === "location" ? locations : panels).map((v) => (
                      <SelectItem key={v} value={v}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="label-filter">Filter</Label>
                <Input
                  id="label-filter"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="CON-011, PNL-H1, Farm Shop, grid…"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="manual-id">Open a panel by ID</Label>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const panelId = parsePanelQr(manual);
                    if (!panelId) {
                      toast.error("Enter a panel ID such as PNL-H1, or a scanned label URL.");
                      return;
                    }
                    void openPanel(panelId);
                  }}
                >
                  <Input
                    id="manual-id"
                    value={manual}
                    onChange={(e) => setManual(e.target.value)}
                    placeholder="PNL-H1"
                  />
                  <Button type="submit" size="icon" variant="outline" aria-label="Open panel">
                    <Search className="h-4 w-4" />
                  </Button>
                </form>
              </div>
            </div>

            <QrScanner onPanel={(panelId) => void openPanel(panelId)} />

            {scopeMode !== "all" && !scopeValue ? (
              <p className="text-xs text-muted-foreground">
                Choose a {scopeMode === "location" ? "location" : "panel"} to narrow the sheet.
                Records with no {scopeMode === "location" ? "recorded location" : "assigned panel"}{" "}
                stay printable under “All records”.
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.print()}
                disabled={!total}
              >
                <Printer className="mr-1 h-4 w-4" /> Print {total} label{total === 1 ? "" : "s"}
              </Button>
              <p className="text-xs text-muted-foreground">
                {perPage} per page · {pages} page{pages === 1 ? "" : "s"}. Set the printer paper to{" "}
                {paperNote(format)} and turn off scaling.
                {LABEL_FORMATS[format].short
                  ? shortQr
                    ? " Shortened output: small QR plus the stable ID (wrapped if long) and one condensed line. Print at 100% and test one scan before running the sheet."
                    : " Shortened output: stable ID plus one condensed line, no QR."
                  : ""}
              </p>
            </div>
          </CardContent>
        </Card>

        {labels.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : labels.error ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Couldn't load labels</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {labels.error instanceof Error ? labels.error.message : "Unknown error."}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Page geometry for the selected label stock; only applies when printing. */}
            <style dangerouslySetInnerHTML={{ __html: labelPrintCss(format) }} />
            <style
              dangerouslySetInnerHTML={{
                __html:
                  // Every group starts a fresh sheet except the very first one in the
                  // whole run. :first-of-type can't express that here, because each
                  // group div lives inside its own per-kind <section>, so it would
                  // exempt the first group of every kind and drop the break between
                  // kinds entirely. The explicit first-group class is parent-agnostic.
                  "@media print { .label-section { break-before: page; page-break-before: always; } .label-section.label-section-first { break-before: auto; page-break-before: auto; } }",
              }}
            />

            {sections.map((section, sectionIndex) => (
              <section key={section.kind} className="space-y-2">
                {kinds.length > 1 ? (
                  <h2 className="flex items-center gap-2 text-sm font-semibold print:hidden">
                    {ENTITIES[section.kind].title}
                    <Badge variant="secondary">{section.records.length}</Badge>
                  </h2>
                ) : null}
                {(LABEL_FORMATS[format].short
                  ? labelWalkGroups(section.records)
                  : [{ key: section.kind, location: "", panel: "", records: section.records }]
                ).map((group, groupIndex) => (
                  <div
                    key={group.key}
                    className={`label-section space-y-1${
                      sectionIndex === 0 && groupIndex === 0 ? " label-section-first" : ""
                    }`}
                  >

                    {LABEL_FORMATS[format].short && (group.location || group.panel) ? (
                      <h3 className="text-xs font-semibold text-muted-foreground">
                        {[group.location || "No location", group.panel || "No panel"].join(" · ")}
                      </h3>
                    ) : null}
                    <div className={gridClass(format)}>
                      {group.records.map((record) =>
                        record.kind === "panel" ? (
                          <PanelQrLabel
                            key={record.id}
                            panel={{
                              panel_id: record.stable_id,
                              description: record.values["description"] ?? null,
                              building: record.values["building"] ?? null,
                              grid: record.values["grid"] ?? null,
                              bus_rating_amps: record.values["bus_rating_amps"] ?? null,
                              voltage: record.values["voltage"] ?? null,
                              phase: record.values["phase"] ?? null,
                              spaces: record.values["spaces"] ?? null,
                              feeder_source: record.values["feeder_source"] ?? null,
                            }}
                            origin={origin}
                            format={format}
                            shortQr={shortQr}
                          />
                        ) : (
                          <EntityQrLabel
                            key={record.id}
                            record={record}
                            origin={origin}
                            format={format}
                            shortQr={shortQr}
                          />
                        ),
                      )}
                    </div>
                  </div>
                ))}
                {!section.records.length ? (
                  <p className="text-sm text-muted-foreground">
                    No {ENTITIES[section.kind].title.toLowerCase()} match this scope.
                  </p>
                ) : null}
              </section>
            ))}

          </div>
        )}
      </div>
    </ElectricalGate>
  );
}
