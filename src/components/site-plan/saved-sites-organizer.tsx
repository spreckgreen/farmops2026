// Saved sites — rename buildings, say which building each one belongs to, and
// fold duplicate site records into a single site.
//
// Only names and grouping change here. Measured outlines, footprints, orientation
// and derived grids are never edited or recalculated by this screen.
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  deleteSitePlan,
  listSitePlans,
  mergeSitePlans,
  resequenceSiteReferences,
  updateSiteBuilding,
  updateSitePlan,
} from "@/lib/site-plan.functions";

const NO_PARENT = "__none__";
const UNSET_ROLE = "__unset__";
const UNSET_SERVICE = "__unset_service__";

const SERVICE_LABELS: Record<string, string> = {
  ELECTRICITY: "Electricity",
  WATER: "Water",
  GAS: "Gas",
  NONE: "None",
};

interface BuildingRow {
  id: string;
  site_plan_id: string;
  temp_name: string;
  building_name: string | null;
  building_role: string | null;
  parent_building_id: string | null;
  service_type: string | null;
  footprint_sqft: number | null;
  fit_length_ft: number | null;
  fit_width_ft: number | null;
  grid_rows: number | null;
  grid_columns: number | null;
  grid_cell_ft: number | null;
  mapped_structure: string | null;
}

interface SiteRow {
  id: string;
  site_name: string;
  address: string | null;
  formatted_address: string | null;
}

export function SavedSitesOrganizer() {
  const listPlans = useServerFn(listSitePlans);
  const saveSite = useServerFn(updateSitePlan);
  const saveBuilding = useServerFn(updateSiteBuilding);
  const merge = useServerFn(mergeSitePlans);
  const resequence = useServerFn(resequenceSiteReferences);
  const remove = useServerFn(deleteSitePlan);
  const queryClient = useQueryClient();

  const plansQuery = useQuery({ queryKey: ["site-plan", "plans"], queryFn: () => listPlans() });
  const sites: SiteRow[] = plansQuery.data?.sites ?? [];
  const buildings: BuildingRow[] = plansQuery.data?.buildings ?? [];

  const [siteNames, setSiteNames] = useState<Record<string, string>>({});
  const [buildingNames, setBuildingNames] = useState<Record<string, string>>({});
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [keepId, setKeepId] = useState<string>("");
  const [foldIds, setFoldIds] = useState<Record<string, boolean>>({});

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["site-plan"] });

  const siteMutation = useMutation({
    mutationFn: (input: { id: string; site_name: string }) => saveSite({ data: input }),
    onSuccess: () => {
      toast.success("Site name saved.");
      void refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const buildingMutation = useMutation({
    mutationFn: (input: Record<string, unknown>) => saveBuilding({ data: input as never }),
    onSuccess: () => {
      toast.success("Building updated.");
      void refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const mergeMutation = useMutation({
    mutationFn: (input: { keep_id: string; merge_ids: string[] }) => merge({ data: input }),
    onSuccess: (result: { moved_sites?: number; renumbered?: number }) => {
      toast.success(
        `Folded ${result?.moved_sites ?? 0} site record(s) into one${
          result?.renumbered ? `, renumbered ${result.renumbered} reference(s)` : ""
        }.`,
      );
      setFoldIds({});
      void refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const resequenceMutation = useMutation({
    mutationFn: (siteId: string) => resequence({ data: { site_id: siteId } }),
    onSuccess: (result: { renumbered?: number }) => {
      toast.success(
        result?.renumbered
          ? `Renumbered ${result.renumbered} reference(s).`
          : "Every reference on this site was already unique.",
      );
      void refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      toast.success("Site removed.");
      void refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const duplicateRefs = useMemo(() => {
    const seen = new Map<string, number>();
    for (const row of buildings) {
      const key = `${row.site_plan_id}|${String(row.temp_name ?? "").trim().toUpperCase()}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    return seen;
  }, [buildings]);

  const foldSelection = Object.entries(foldIds)
    .filter(([id, on]) => on && id !== keepId)
    .map(([id]) => id);

  return (
    <div className="space-y-3">
      {sites.length > 1 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">One physical address, one site</CardTitle>
            <CardDescription>
              There {sites.length === 2 ? "are" : "are"} {sites.length} separate site records. Pick
              the one to keep and tick the others to move their buildings across, so every building
              at the address sits together with unique references.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="space-y-1">
              <Label>Site to keep</Label>
              <Select value={keepId} onValueChange={setKeepId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose the site to keep" />
                </SelectTrigger>
                <SelectContent>
                  {sites.map((site) => (
                    <SelectItem key={site.id} value={site.id}>
                      {site.site_name} — {site.formatted_address || site.address || "no address"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Fold these in</Label>
              {sites
                .filter((site) => site.id !== keepId)
                .map((site) => {
                  const rows = buildings.filter((b) => b.site_plan_id === site.id);
                  return (
                    <label key={site.id} className="flex items-start gap-2">
                      <Checkbox
                        checked={Boolean(foldIds[site.id])}
                        onCheckedChange={(value) =>
                          setFoldIds((current) => ({ ...current, [site.id]: value === true }))
                        }
                      />
                      <span>
                        <span className="font-medium">{site.site_name}</span>{" "}
                        <span className="text-muted-foreground">
                          ({rows.length} building{rows.length === 1 ? "" : "s"}:{" "}
                          {rows.map((r) => r.building_name || r.temp_name).join(", ") || "none"})
                        </span>
                      </span>
                    </label>
                  );
                })}
            </div>
            <p className="text-xs text-muted-foreground">
              Buildings keep their measured outlines and grids. "Belongs to" links are cleared on the
              moved buildings so you can set them again on the combined site.
            </p>
            <Button
              size="sm"
              disabled={!keepId || foldSelection.length === 0 || mergeMutation.isPending}
              onClick={() => mergeMutation.mutate({ keep_id: keepId, merge_ids: foldSelection })}
            >
              Combine into one site
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Saved sites</CardTitle>
          <CardDescription>
            Rename any building, mark the main building, and say which building each outbuilding
            belongs to.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {plansQuery.isLoading ? <p className="text-muted-foreground">Loading…</p> : null}
          {!plansQuery.isLoading && sites.length === 0 ? (
            <p className="text-muted-foreground">No sites recorded yet.</p>
          ) : null}

          {sites.map((site) => {
            const rows = buildings.filter((b) => b.site_plan_id === site.id);
            const nameValue = siteNames[site.id] ?? site.site_name;
            return (
              <div key={site.id} className="space-y-3 rounded-md border p-3">
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-48 flex-1 space-y-1">
                    <Label htmlFor={`site-${site.id}`}>Site name</Label>
                    <Input
                      id={`site-${site.id}`}
                      value={nameValue}
                      onChange={(event) =>
                        setSiteNames((current) => ({ ...current, [site.id]: event.target.value }))
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      {site.formatted_address || site.address}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={nameValue.trim() === site.site_name || siteMutation.isPending}
                    onClick={() =>
                      siteMutation.mutate({ id: site.id, site_name: nameValue.trim() })
                    }
                  >
                    Save name
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={resequenceMutation.isPending}
                    onClick={() => resequenceMutation.mutate(site.id)}
                  >
                    Renumber references
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate(site.id)}
                  >
                    Remove site
                  </Button>
                </div>

                <Separator />

                {rows.length === 0 ? (
                  <p className="text-muted-foreground">No buildings recorded.</p>
                ) : (
                  <div className="space-y-3">
                    {rows.map((row) => {
                      const refKey = `${row.site_plan_id}|${String(row.temp_name ?? "")
                        .trim()
                        .toUpperCase()}`;
                      const isDuplicate = (duplicateRefs.get(refKey) ?? 0) > 1;
                      const nameDraft = buildingNames[row.id] ?? row.building_name ?? "";
                      const refDraft = refs[row.id] ?? row.temp_name;
                      const dirty =
                        nameDraft.trim() !== (row.building_name ?? "") ||
                        refDraft.trim() !== row.temp_name;
                      return (
                        <div key={row.id} className="space-y-2 rounded-md border p-3">
                          <div className="grid gap-2 sm:grid-cols-2">
                            <div className="space-y-1">
                              <Label htmlFor={`bname-${row.id}`}>Building name</Label>
                              <Input
                                id={`bname-${row.id}`}
                                placeholder="e.g. Farm House"
                                value={nameDraft}
                                onChange={(event) =>
                                  setBuildingNames((current) => ({
                                    ...current,
                                    [row.id]: event.target.value,
                                  }))
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor={`bref-${row.id}`}>Reference</Label>
                              <Input
                                id={`bref-${row.id}`}
                                value={refDraft}
                                onChange={(event) =>
                                  setRefs((current) => ({
                                    ...current,
                                    [row.id]: event.target.value,
                                  }))
                                }
                              />
                              {isDuplicate ? (
                                <p className="text-xs text-destructive">
                                  Another building on this site uses this reference. Rename it or use
                                  Renumber references.
                                </p>
                              ) : null}
                            </div>
                          </div>

                          <div className="grid gap-2 sm:grid-cols-2">
                            <div className="space-y-1">
                              <Label>Role on this site</Label>
                              <Select
                                value={row.building_role ?? UNSET_ROLE}
                                onValueChange={(value) =>
                                  buildingMutation.mutate({
                                    id: row.id,
                                    building_role: value === UNSET_ROLE ? null : value,
                                    ...(value === "PRIMARY" ? { parent_building_id: null } : {}),
                                  })
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={UNSET_ROLE}>Not decided yet</SelectItem>
                                  <SelectItem value="PRIMARY">Main building</SelectItem>
                                  <SelectItem value="OUTBUILDING">Outbuilding</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1">
                              <Label>Belongs to</Label>
                              <Select
                                value={row.parent_building_id ?? NO_PARENT}
                                onValueChange={(value) =>
                                  buildingMutation.mutate({
                                    id: row.id,
                                    parent_building_id: value === NO_PARENT ? null : value,
                                    ...(value === NO_PARENT ? {} : { building_role: "OUTBUILDING" }),
                                  })
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={NO_PARENT}>Stands on its own</SelectItem>
                                  {rows
                                    .filter((other) => other.id !== row.id)
                                    .map((other) => (
                                      <SelectItem key={other.id} value={other.id}>
                                        {other.building_name || other.temp_name}
                                      </SelectItem>
                                    ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>

                          <div className="grid gap-2 sm:grid-cols-2">
                            <div className="space-y-1">
                              <Label>Service type</Label>
                              <Select
                                value={row.service_type ?? UNSET_SERVICE}
                                onValueChange={(value) =>
                                  buildingMutation.mutate({
                                    id: row.id,
                                    service_type: value === UNSET_SERVICE ? null : value,
                                  })
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Not decided yet" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={UNSET_SERVICE}>Not decided yet</SelectItem>
                                  <SelectItem value="ELECTRICITY">Electricity</SelectItem>
                                  <SelectItem value="WATER">Water</SelectItem>
                                  <SelectItem value="GAS">Gas</SelectItem>
                                  <SelectItem value="NONE">None</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1">
                              <Label>Outbuildings depending on this one</Label>
                              {rows.filter((other) => other.parent_building_id === row.id).length ===
                              0 ? (
                                <p className="text-xs text-muted-foreground">
                                  Nothing depends on this building yet.
                                </p>
                              ) : (
                                <ul className="space-y-1 text-xs">
                                  {rows
                                    .filter((other) => other.parent_building_id === row.id)
                                    .map((child) => (
                                      <li key={child.id} className="flex items-center gap-2">
                                        <span>{child.building_name || child.temp_name}</span>
                                        <Badge variant="outline">
                                          {child.service_type
                                            ? SERVICE_LABELS[child.service_type]
                                            : "Service not decided"}
                                        </Badge>
                                        <span className="text-muted-foreground">
                                          {loadCounts[child.id]
                                            ? `${loadCounts[child.id]} electrical load${
                                                loadCounts[child.id] === 1 ? "" : "s"
                                              }`
                                            : "no electrical loads linked"}
                                        </span>
                                      </li>
                                    ))}
                                </ul>
                              )}
                            </div>
                          </div>

                          <p className="text-xs text-muted-foreground">
                            {Number(row.footprint_sqft ?? 0).toFixed(0)} sq ft ·{" "}
                            {Number(row.fit_length_ft ?? 0).toFixed(0)}′ ×{" "}
                            {Number(row.fit_width_ft ?? 0).toFixed(0)}′ · grid {row.grid_rows}×
                            {row.grid_columns} at {Number(row.grid_cell_ft ?? 0)}′
                            {row.mapped_structure ? ` · mapped to ${row.mapped_structure}` : ""}
                          </p>

                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!dirty || buildingMutation.isPending}
                              onClick={() =>
                                buildingMutation.mutate({
                                  id: row.id,
                                  building_name: nameDraft.trim() === "" ? null : nameDraft.trim(),
                                  temp_name: refDraft.trim(),
                                })
                              }
                            >
                              Save building
                            </Button>
                            {row.building_role === "PRIMARY" ? (
                              <Badge variant="secondary">Main building</Badge>
                            ) : null}
                            {row.building_role === "OUTBUILDING" ? (
                              <Badge variant="outline">Outbuilding</Badge>
                            ) : null}
                            {row.service_type ? (
                              <Badge variant="secondary">
                                {SERVICE_LABELS[row.service_type]}
                              </Badge>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
