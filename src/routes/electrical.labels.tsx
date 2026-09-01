// Panel QR labels: print a sheet (or one jumbo label) for every panel, and scan
// a label with the device camera to open that panel's read-only sheet.
import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Camera, CameraOff, Printer, QrCode, Search } from "lucide-react";

import { ElectricalGate } from "@/components/electrical/electrical-gate";
import { PanelQrLabel, type QrSize } from "@/components/electrical/panel-qr-label";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { listPanelLabels, type PanelLabel } from "@/lib/panel-access.functions";
import { parsePanelQr } from "@/lib/electrical-panel-access";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
      { title: "Panel QR Labels — Bostead Farms Electrical" },
      {
        name: "description",
        content:
          "Print scannable QR labels for every electrical panel and scan one in the field to open its current read-only panel sheet.",
      },
      { property: "og:title", content: "Panel QR Labels — Bostead Farms Electrical" },
      {
        property: "og:description",
        content:
          "Large printable panel labels with QR codes that open the live panel record for the electrician.",
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
            if (!panelId) {
              setError(`That code isn't a panel label: ${decoded.slice(0, 60)}`);
              return;
            }
            void scanner.stop().then(() => scanner.clear()).catch(() => undefined);
            setActive(false);
            onPanel(panelId);
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
              <Camera className="mr-1 h-4 w-4" /> Scan a panel label
            </>
          )}
        </Button>
      </div>
      <div id={containerId} className={active ? "overflow-hidden rounded-md border" : "hidden"} />
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function PanelLabelsPage() {
  const navigate = useNavigate();
  const fetchLabels = useServerFn(listPanelLabels);
  const [filter, setFilter] = useState("");
  const [size, setSize] = useState<QrSize>("sheet");
  const [manual, setManual] = useState("");

  const labels = useQuery({ queryKey: ["panel-labels"], queryFn: () => fetchLabels() });
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  const openPanel = (panelId: string) =>
    navigate({ to: "/electrical/panel/$panelId", params: { panelId } });

  const visible = useMemo(() => {
    const rows: PanelLabel[] = labels.data ?? [];
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.panel_id, r.description, r.building, r.grid, r.feeder_source]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [labels.data, filter]);

  return (
    <ElectricalGate>
      <div className="space-y-4">
        <Card className="print:hidden">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <QrCode className="h-4 w-4" /> Panel labels
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Each QR code opens that panel's current record, read-only. An electrician can request a
              24-hour edit window from the panel sheet; an administrator approves it.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="label-filter">Filter panels</Label>
                <Input
                  id="label-filter"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="PNL-H1, Farm Shop, grid…"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="label-size">Label size</Label>
                <Select value={size} onValueChange={(v) => setSize(v as QrSize)}>
                  <SelectTrigger id="label-size">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sheet">Sheet — many per page</SelectItem>
                    <SelectItem value="large">Large — 2 per page</SelectItem>
                    <SelectItem value="jumbo">Jumbo — 1 per page</SelectItem>
                  </SelectContent>
                </Select>
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
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="mr-1 h-4 w-4" /> Print {visible.length} label
              {visible.length === 1 ? "" : "s"}
            </Button>
          </CardContent>
        </Card>

        {labels.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : labels.error ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Couldn't load panels</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {labels.error instanceof Error ? labels.error.message : "Unknown error."}
            </CardContent>
          </Card>
        ) : (
          <div
            className={
              size === "sheet"
                ? "grid gap-3 sm:grid-cols-2"
                : size === "large"
                  ? "grid gap-4 sm:grid-cols-2 print:grid-cols-1"
                  : "grid gap-6 grid-cols-1"
            }
          >
            {visible.map((panel) => (
              <PanelQrLabel
                key={panel.id}
                panel={panel}
                origin={origin}
                size={size}
                className="print:break-after-auto"
              />
            ))}
            {!visible.length ? (
              <p className="text-sm text-muted-foreground">No panels match that filter.</p>
            ) : null}
          </div>
        )}
      </div>
    </ElectricalGate>
  );
}
