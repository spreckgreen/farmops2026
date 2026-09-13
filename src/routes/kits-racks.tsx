// Every kit and rack build-out on the place, in one list, with a picture of how
// each rack is stacked (bottom space at the bottom, just like the real rack).
import {
  createFileRoute,
  Link,
  Outlet,
  useLocation,
} from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AppLayout } from "@/components/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Boxes,
  Server,
  AlertTriangle,
  ArrowLeft,
  Wrench,
  ChevronDown,
  ChevronRight,
  PackagePlus,
  Printer,
  ArrowUp,
  PackageOpen,
} from "lucide-react";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import {
  listKitRackBuildouts,
  listRacksWithoutKit,
  createBag,
  type KitRackBuildout,
  type RackWithoutKit,
} from "@/lib/kit-rack-index.functions";
import { createRackKit } from "@/lib/rack-kit.functions";
import { buildRackElevation, formatSpan } from "@/lib/rack-elevation";
import { KitBuildCard } from "@/components/kit-build-card";
import { addBomComponent } from "@/lib/inventory-bom.functions";
import { printContainerLabelPair } from "@/lib/inventory-label-print";

export const Route = createFileRoute("/kits-racks")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({
    meta: [
      { title: "Kits & rack build-outs — Bostead Farms" },
      {
        name: "description",
        content:
          "Every inventory kit and equipment rack build-out, with the parts list and rack elevation for each.",
      },
      {
        property: "og:title",
        content: "Kits & rack build-outs — Bostead Farms",
      },
      {
        property: "og:description",
        content:
          "Kit parts lists and rack elevations recorded for the farm's equipment.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: KitsRacksRoute,
});

/** Render the index workspace only at /kits-racks; child kit URLs need the outlet. */
function KitsRacksRoute() {
  const pathname = useLocation().pathname;
  return pathname === "/kits-racks" || pathname === "/kits-racks/" ? (
    <KitsRacksPageV2 />
  ) : (
    <Outlet />
  );
}

const U_PX = 26;

/** Bottom-up picture of a rack, drawn only from recorded sizes and positions. */
function ElevationPreview({ buildout }: { buildout: KitRackBuildout }) {
  const sizeU = buildout.rack?.sizeU ?? null;
  const elevation = buildRackElevation(
    buildout.parts.map((p) => ({
      id: p.id,
      name: p.name,
      rackUnits: p.rackUnits,
      positionU: p.positionU,
      quantity: p.quantity,
    })),
    sizeU,
  );

  if (sizeU == null) {
    return (
      <p className="text-xs text-muted-foreground">
        No rack height recorded, so the stack can't be drawn.
      </p>
    );
  }

  const blocks: React.ReactElement[] = [];
  let u = sizeU;
  while (u >= 1) {
    const part = elevation.placed.find((p) => p.topU === u);
    if (part) {
      blocks.push(
        <div
          key={`p${part.id}`}
          className="flex items-center justify-between gap-2 border-b border-border/60 bg-card px-2 text-xs"
          style={{ height: part.rackUnits * U_PX }}
        >
          <span className="truncate font-medium">{part.name}</span>
          <span className="shrink-0 text-muted-foreground">
            {formatSpan(part)}
          </span>
        </div>,
      );
      u -= part.rackUnits;
      continue;
    }
    blocks.push(
      <div
        key={`e${u}`}
        className="flex items-center border-b border-dashed border-border/40 px-2 text-[11px] text-muted-foreground"
        style={{ height: U_PX }}
      >
        U{u}
      </div>,
    );
    u -= 1;
  }

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-md border-x-4 border-y border-border bg-muted/40">
        {blocks}
      </div>
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">
          {elevation.usedU} of {sizeU} spaces used
        </Badge>
        {elevation.unplaced.length > 0 ? (
          <Badge variant="secondary">
            {elevation.unplaced.length} part(s) not placed
          </Badge>
        ) : null}
      </div>
      {(elevation.conflicts.length > 0 || elevation.overflow.length > 0) && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs">
          <div className="flex items-center gap-1 font-medium text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" />
            Check these positions
          </div>
          <ul className="mt-1 list-disc pl-5 text-muted-foreground">
            {elevation.conflicts.map((c, i) => (
              <li key={`c${i}`}>
                {c.a} and {c.b} both claim U{c.spaces.join(", U")}
              </li>
            ))}
            {elevation.overflow.map((o) => (
              <li key={o.id}>
                {o.name} at {formatSpan(o)} runs past the top of the rack
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function usePersistentOpen(key: string) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(key) === "open");
    } catch {
      /* unavailable */
    }
    const toggle = (event: Event) => {
      const next = Boolean(
        (event as CustomEvent<{ open: boolean }>).detail?.open,
      );
      setOpen(next);
      try {
        localStorage.setItem(key, next ? "open" : "closed");
      } catch {
        /* unavailable */
      }
    };
    window.addEventListener("farmops:kits-racks:toggle", toggle);
    return () =>
      window.removeEventListener("farmops:kits-racks:toggle", toggle);
  }, [key]);
  const change = (next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(key, next ? "open" : "closed");
    } catch {
      /* unavailable */
    }
  };
  return [open, change] as const;
}

function BuildoutCard({
  buildout,
  onWork,
  active = false,
}: {
  buildout: KitRackBuildout;
  onWork?: () => void;
  active?: boolean;
}) {
  const isRack = Boolean(buildout.rack);
  const [open, setOpen] = usePersistentOpen(
    `farmops:kits-racks:pane:${buildout.kitId}`,
  );
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className={active ? "ring-2 ring-primary" : undefined}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer pb-2 hover:bg-muted/30">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              {open ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              {isRack ? (
                <Server className="h-4 w-4" />
              ) : (
                <Boxes className="h-4 w-4" />
              )}
              {buildout.rack?.stableId || buildout.kitName}
              <Badge variant={isRack ? "default" : "secondary"}>
                {isRack
                  ? "Rack build-out"
                  : buildout.containerKind === "bag"
                    ? "Bag / mini-kit"
                    : "Kit"}
              </Badge>
              <Badge variant="outline">
                {buildout.parts.length}{" "}
                {buildout.parts.length === 1 ? "part" : "parts"}
              </Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {isRack ? `${buildout.kitName} · ` : ""}
              {buildout.rack?.description ||
                buildout.location ||
                "No location recorded"}
            </p>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-3 text-sm">
            {isRack ? <ElevationPreview buildout={buildout} /> : null}

            {buildout.parts.length === 0 ? (
              <p className="text-muted-foreground">
                No parts listed yet — add its contents to see them here.
              </p>
            ) : (
              <ul className="divide-y divide-border/60 text-xs">
                {buildout.parts.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 py-1"
                  >
                    <span className="truncate">{p.name}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {p.quantity}
                      {p.unit ? ` ${p.unit}` : ""}
                      {p.rackUnits != null ? ` · ${p.rackUnits}U` : ""}
                      {p.positionU != null ? ` @ U${p.positionU}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={onWork} disabled={!onWork}>
                <Wrench className="mr-1 h-4 w-4" /> Work on this{" "}
                {isRack
                  ? "rack"
                  : buildout.containerKind === "bag"
                    ? "bag"
                    : "kit"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  printContainerLabelPair(buildout).catch((e: Error) =>
                    toast.error(e.message),
                  )
                }
              >
                <Printer className="mr-1 h-4 w-4" /> Print label
              </Button>
              {isRack && buildout.rack ? (
                <Button size="sm" variant="outline" asChild>
                  <Link
                    to="/electrical/item/$kind/$id"
                    params={{ kind: "rack", id: buildout.rack.id }}
                  >
                    Open rack
                  </Link>
                </Button>
              ) : null}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function BareRackCard({
  rack,
  onStart,
  busy,
}: {
  rack: RackWithoutKit;
  onStart: () => void;
  busy: boolean;
}) {
  const [open, setOpen] = usePersistentOpen(
    `farmops:kits-racks:pane:rack:${rack.id}`,
  );
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer pb-2 hover:bg-muted/30">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              {open ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              <Server className="h-4 w-4" /> {rack.stableId || "Equipment rack"}
              <Badge variant="default">Rack</Badge>
              <Badge variant="outline">
                {rack.sizeU == null
                  ? "No height recorded"
                  : `${rack.sizeU} spaces`}
              </Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {rack.description || "No description recorded"}
            </p>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="flex flex-wrap gap-2">
            <Button size="sm" onClick={onStart} disabled={busy}>
              <Wrench className="mr-1 h-4 w-4" /> Start build kit
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link
                to="/electrical/item/$kind/$id"
                params={{ kind: "rack", id: rack.id }}
              >
                Open rack
              </Link>
            </Button>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function BuildWorkspace({
  target,
  bags,
}: {
  target: KitRackBuildout | null;
  bags: KitRackBuildout[];
}) {
  const qc = useQueryClient();
  const addMember = useServerFn(addBomComponent);
  const addBag = useServerFn(createBag);
  const [drillBagId, setDrillBagId] = useState<string | null>(null);
  const [selectedBagId, setSelectedBagId] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [home, setHome] = useState("");
  const [open, setOpen] = usePersistentOpen(
    "farmops:kits-racks:build-workspace",
  );

  useEffect(() => {
    setDrillBagId(null);
    setSelectedBagId("");
  }, [target?.kitId]);

  const current = drillBagId
    ? (bags.find((b) => b.kitId === drillBagId) ?? null)
    : target;
  const directBagIds = new Set(
    (target?.parts ?? [])
      .map((part) => part.componentItemId)
      .filter((id) => bags.some((bag) => bag.kitId === id)),
  );
  const selectedBag = bags.find((bag) => bag.kitId === selectedBagId) ?? null;

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["kit-rack-buildouts"] }),
      target
        ? qc.invalidateQueries({ queryKey: ["kit-build", target.kitId] })
        : Promise.resolve(),
    ]);
  };

  const assign = useMutation({
    mutationFn: () =>
      addMember({
        data: {
          parentItemId: target!.kitId,
          componentItemId: selectedBagId,
          quantity: 1,
          unit: "bag",
          notes: "Nested bag / mini-kit",
        },
      }),
    onSuccess: async () => {
      await refresh();
      toast.success("Bag assigned to kit");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const create = useMutation({
    mutationFn: () =>
      addBag({
        data: {
          name,
          sku: sku || null,
          homeLocation: home || null,
          parentKitItemId: target!.kitId,
        },
      }),
    onSuccess: async ({ id }) => {
      await refresh();
      setName("");
      setSku("");
      setHome("");
      setShowCreate(false);
      setDrillBagId(id);
      toast.success("Bag created and assigned — add its parts now");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!target) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Build workspace</CardTitle>
          <p className="text-sm text-muted-foreground">
            Choose Work on this kit, bag, or rack from either focused pane.
          </p>
        </CardHeader>
      </Card>
    );
  }

  const isKit = !target.rack && target.containerKind === "kit";
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="border-primary/40">
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/30">
            <CardTitle className="flex items-center gap-2 text-base">
              {open ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              <PackageOpen className="h-4 w-4" />
              Build workspace · {target.rack?.stableId || target.kitName}
              {drillBagId ? (
                <Badge variant="secondary">Inside bag</Badge>
              ) : null}
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4">
            {drillBagId ? (
              <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-2 text-sm">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDrillBagId(null)}
                >
                  <ArrowUp className="mr-1 h-4 w-4" /> Back to {target.kitName}
                </Button>
                <span>{target.kitName}</span>
                <span>›</span>
                <span className="font-medium">{current?.kitName}</span>
              </div>
            ) : null}

            {isKit && !drillBagId ? (
              <div className="space-y-3 rounded-md border p-3">
                <div>
                  <h3 className="font-medium">Bags in this kit</h3>
                  <p className="text-xs text-muted-foreground">
                    Preview an existing bag, assign it to this kit, or create a
                    nested bag.
                  </p>
                </div>
                <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]">
                  <Select
                    value={selectedBagId}
                    onValueChange={setSelectedBagId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a bag / mini-kit" />
                    </SelectTrigger>
                    <SelectContent>
                      {bags
                        .filter((bag) => bag.kitId !== target.kitId)
                        .map((bag) => (
                          <SelectItem key={bag.kitId} value={bag.kitId}>
                            {bag.kitName} · {bag.parts.length} part
                            {bag.parts.length === 1 ? "" : "s"}
                            {directBagIds.has(bag.kitId) ? " · assigned" : ""}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    disabled={!selectedBag || directBagIds.has(selectedBagId)}
                    onClick={() => assign.mutate()}
                  >
                    Assign to kit
                  </Button>
                  <Button
                    disabled={!selectedBag}
                    onClick={() => setDrillBagId(selectedBagId)}
                  >
                    Open bag
                  </Button>
                </div>
                {selectedBag ? (
                  <div className="rounded-md bg-muted/30 p-2 text-xs">
                    <div className="font-medium">{selectedBag.kitName}</div>
                    <div className="text-muted-foreground">
                      Home: {selectedBag.location || "Not recorded"}
                    </div>
                    <div className="mt-1">
                      {selectedBag.parts.length
                        ? selectedBag.parts
                            .map((part) => `${part.name} × ${part.quantity}`)
                            .join(", ")
                        : "No parts in this bag yet."}
                    </div>
                  </div>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowCreate((value) => !value)}
                >
                  <PackagePlus className="mr-1 h-4 w-4" /> Create a bag in this
                  kit
                </Button>
                {showCreate ? (
                  <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_180px_minmax(0,1fr)_auto] md:items-end">
                    <div>
                      <Label>Bag name</Label>
                      <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label>Bag ID / SKU</Label>
                      <Input
                        value={sku}
                        onChange={(e) => setSku(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label>Home location</Label>
                      <Input
                        value={home}
                        onChange={(e) => setHome(e.target.value)}
                        placeholder={target.kitName}
                      />
                    </div>
                    <Button
                      disabled={!name.trim() || create.isPending}
                      onClick={() => create.mutate()}
                    >
                      Create, assign &amp; open
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {current ? <KitBuildCard kitItemId={current.kitId} /> : null}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function KitsRacksPageV2() {
  const fn = useServerFn(listKitRackBuildouts);
  const rackFn = useServerFn(listRacksWithoutKit);
  const startKit = useServerFn(createRackKit);
  const addBag = useServerFn(createBag);
  const qc = useQueryClient();
  const [focusOne, setFocusOne] = useState("");
  const [focusTwo, setFocusTwo] = useState("");
  const [activeKey, setActiveKey] = useState("");
  const [showNewBag, setShowNewBag] = useState(false);
  const [bagName, setBagName] = useState("");
  const [bagSku, setBagSku] = useState("");
  const [bagHome, setBagHome] = useState("");

  const q = useQuery<KitRackBuildout[]>({
    queryKey: ["kit-rack-buildouts"],
    queryFn: () => fn(),
  });
  const bare = useQuery<RackWithoutKit[]>({
    queryKey: ["racks-without-kit"],
    queryFn: () => rackFn(),
  });

  const start = useMutation({
    mutationFn: (rackId: string) => startKit({ data: { rackId } }),
    onSuccess: async (view) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["kit-rack-buildouts"] }),
        qc.invalidateQueries({ queryKey: ["racks-without-kit"] }),
      ]);
      if (view?.kit) setActiveKey(`build:${view.kit.id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const create = useMutation({
    mutationFn: () =>
      addBag({
        data: {
          name: bagName,
          sku: bagSku || null,
          homeLocation: bagHome || null,
        },
      }),
    onSuccess: async ({ id }) => {
      await qc.invalidateQueries({ queryKey: ["kit-rack-buildouts"] });
      setBagName("");
      setBagSku("");
      setBagHome("");
      setShowNewBag(false);
      toast.success("Bag created — add its contents next");
      setActiveKey(`build:${id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const buildouts = useMemo(
    () =>
      [...(q.data ?? [])].sort((a, b) =>
        (a.rack?.stableId || a.kitName).localeCompare(
          b.rack?.stableId || b.kitName,
        ),
      ),
    [q.data],
  );
  const options = useMemo(
    () => [
      ...buildouts.map((b) => ({
        key: `build:${b.kitId}`,
        label: `${b.rack ? "Rack" : b.containerKind === "bag" ? "Bag" : "Kit"}: ${b.rack?.stableId || b.kitName}`,
      })),
      ...(bare.data ?? []).map((r) => ({
        key: `rack:${r.id}`,
        label: `Rack: ${r.stableId || "Equipment rack"}`,
      })),
    ],
    [buildouts, bare.data],
  );

  useEffect(() => {
    if (options.length === 0) return;
    const keys = new Set(options.map((o) => o.key));
    let savedOne = "";
    let savedTwo = "";
    try {
      savedOne = localStorage.getItem("farmops:kits-racks:focus:1") || "";
      savedTwo = localStorage.getItem("farmops:kits-racks:focus:2") || "";
    } catch {
      /* unavailable */
    }
    const one = keys.has(savedOne) ? savedOne : options[0]?.key || "";
    const twoCandidate =
      keys.has(savedTwo) && savedTwo !== one
        ? savedTwo
        : options.find((o) => o.key !== one)?.key || "";
    setFocusOne((current) => current || one);
    setFocusTwo((current) => current || twoCandidate);
    setActiveKey((current) => current || one);
  }, [options]);

  const selectFocus = (slot: 1 | 2, value: string) => {
    if (
      (slot === 1 && value === focusTwo) ||
      (slot === 2 && value === focusOne)
    ) {
      toast.error("Choose two different kits, bags, or racks.");
      return;
    }
    if (slot === 1) setFocusOne(value);
    else setFocusTwo(value);
    try {
      localStorage.setItem(`farmops:kits-racks:focus:${slot}`, value);
    } catch {
      /* unavailable */
    }
  };

  const renderEntity = (key: string) => {
    if (key.startsWith("build:")) {
      const item = buildouts.find((b) => b.kitId === key.slice(6));
      return item ? (
        <BuildoutCard
          key={key}
          buildout={item}
          active={activeKey === key}
          onWork={() => setActiveKey(key)}
        />
      ) : null;
    }
    const rack = (bare.data ?? []).find((r) => r.id === key.slice(5));
    return rack ? (
      <BareRackCard
        key={key}
        rack={rack}
        onStart={() => start.mutate(rack.id)}
        busy={start.isPending}
      />
    ) : null;
  };

  const focused = new Set([focusOne, focusTwo].filter(Boolean));
  const activeTarget = activeKey.startsWith("build:")
    ? (buildouts.find((item) => item.kitId === activeKey.slice(6)) ?? null)
    : null;
  const kits = buildouts.filter(
    (b) =>
      !b.rack && b.containerKind === "kit" && !focused.has(`build:${b.kitId}`),
  );
  const bags = buildouts.filter(
    (b) =>
      !b.rack && b.containerKind === "bag" && !focused.has(`build:${b.kitId}`),
  );
  const rackBuilds = buildouts.filter(
    (b) => b.rack && !focused.has(`build:${b.kitId}`),
  );
  const bareRacks = (bare.data ?? []).filter(
    (r) => !focused.has(`rack:${r.id}`),
  );
  const toggleAll = (open: boolean) =>
    window.dispatchEvent(
      new CustomEvent("farmops:kits-racks:toggle", { detail: { open } }),
    );

  return (
    <AppLayout>
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold">
              Kits, bags &amp; rack build-outs
            </h1>
            <p className="text-sm text-muted-foreground">
              Build nested field kits, label their bags, and track where every
              part is now.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => toggleAll(false)}
            >
              Collapse all
            </Button>
            <Button size="sm" variant="outline" onClick={() => toggleAll(true)}>
              Expand all
            </Button>
            <Button size="sm" onClick={() => setShowNewBag((v) => !v)}>
              <PackagePlus className="mr-1 h-4 w-4" /> New bag
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link to="/inventory">
                <ArrowLeft className="mr-1 h-4 w-4" /> Inventory
              </Link>
            </Button>
          </div>
        </div>

        {showNewBag ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Build a labeled bag / mini-kit
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_minmax(0,1fr)_auto] md:items-end">
              <div>
                <Label>Name</Label>
                <Input
                  value={bagName}
                  onChange={(e) => setBagName(e.target.value)}
                  placeholder="e.g. Bug-out Comm — Power bag"
                />
              </div>
              <div>
                <Label>Bag ID / SKU</Label>
                <Input
                  value={bagSku}
                  onChange={(e) => setBagSku(e.target.value)}
                  placeholder="BAG-COMM-01"
                />
              </div>
              <div>
                <Label>Home location</Label>
                <Input
                  value={bagHome}
                  onChange={(e) => setBagHome(e.target.value)}
                  placeholder="Farm Shop · cabinet 2"
                />
              </div>
              <Button
                disabled={!bagName.trim() || create.isPending}
                onClick={() => create.mutate()}
              >
                Create &amp; add contents
              </Button>
            </CardContent>
          </Card>
        ) : null}

        <BuildWorkspace
          target={activeTarget}
          bags={buildouts.filter(
            (item) => !item.rack && item.containerKind === "bag",
          )}
        />

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Focused work</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {[
              { slot: 1 as const, value: focusOne },
              { slot: 2 as const, value: focusTwo },
            ].map(({ slot, value }) => (
              <div key={slot} className="space-y-2">
                <Label>Focus {slot}</Label>
                <Select
                  value={value}
                  onValueChange={(v) => selectFocus(slot, v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a kit, bag, or rack" />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((o) => (
                      <SelectItem
                        key={o.key}
                        value={o.key}
                        disabled={(slot === 1 ? focusTwo : focusOne) === o.key}
                      >
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </CardContent>
        </Card>

        {q.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : q.error ? (
          <p className="text-destructive">{(q.error as Error).message}</p>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              {renderEntity(focusOne)}
              {renderEntity(focusTwo)}
            </div>
            <section className="space-y-4">
              <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                Other kits, bags &amp; racks
              </h2>
              {kits.length ? (
                <div className="space-y-2">
                  <h3 className="font-medium">Kits ({kits.length})</h3>
                  {kits.map((b) => (
                    <BuildoutCard
                      key={b.kitId}
                      buildout={b}
                      active={activeKey === `build:${b.kitId}`}
                      onWork={() => setActiveKey(`build:${b.kitId}`)}
                    />
                  ))}
                </div>
              ) : null}
              {bags.length ? (
                <div className="space-y-2">
                  <h3 className="font-medium">
                    Bags / mini-kits ({bags.length})
                  </h3>
                  {bags.map((b) => (
                    <BuildoutCard
                      key={b.kitId}
                      buildout={b}
                      active={activeKey === `build:${b.kitId}`}
                      onWork={() => setActiveKey(`build:${b.kitId}`)}
                    />
                  ))}
                </div>
              ) : null}
              {rackBuilds.length || bareRacks.length ? (
                <div className="space-y-2">
                  <h3 className="font-medium">
                    Racks ({rackBuilds.length + bareRacks.length})
                  </h3>
                  {rackBuilds.map((b) => (
                    <BuildoutCard
                      key={b.kitId}
                      buildout={b}
                      active={activeKey === `build:${b.kitId}`}
                      onWork={() => setActiveKey(`build:${b.kitId}`)}
                    />
                  ))}
                  {bareRacks.map((r) => (
                    <BareRackCard
                      key={r.id}
                      rack={r}
                      onStart={() => start.mutate(r.id)}
                      busy={start.isPending}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          </>
        )}
      </div>
    </AppLayout>
  );
}
