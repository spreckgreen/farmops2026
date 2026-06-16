import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Plus,
  ArrowLeft,
  Wrench,
  Package,
  Download,
  Search,
  AlertTriangle,
  CheckCircle,
  Clock,
  CalendarDays,
} from "lucide-react";
import ScheduleDialog from "@/components/scheduling/ScheduleDialog";
import ScheduleList from "@/components/scheduling/ScheduleList";
import ConsumableDialog from "@/components/scheduling/ConsumableDialog";
import ConsumableList from "@/components/scheduling/ConsumableList";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import type { Asset } from "@/components/dashboard/types";
import type {
  ServiceSchedule,
  ServiceScheduleFormData,
  Consumable,
  ConsumableFormData,
  ConsumableUsage,
} from "@/types/scheduling";

export const Route = createFileRoute("/service-scheduling")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({
    meta: [
      { title: "Service Scheduling — Bostead Farms" },
      { name: "description", content: "Schedule services and track consumables for your assets." },
    ],
  }),
  component: ServiceSchedulingPage,
});

function ServiceSchedulingPage() {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [schedules, setSchedules] = useState<ServiceSchedule[]>([]);
  const [consumables, setConsumables] = useState<Consumable[]>([]);
  const [loading, setLoading] = useState(true);

  const [activeTab, setActiveTab] = useState("schedules");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [showLowStock, setShowLowStock] = useState(false);

  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<ServiceSchedule | null>(null);
  const [consumableDialogOpen, setConsumableDialogOpen] = useState(false);
  const [editingConsumable, setEditingConsumable] = useState<Consumable | null>(null);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (!s) navigate({ to: "/auth" });
    });
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (!s) navigate({ to: "/auth" });
    });
    return () => subscription.unsubscribe();
  }, [navigate]);

  useEffect(() => {
    if (session) fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const fetchAll = async () => {
    setLoading(true);
    const [assetsRes, schedulesRes, consumablesRes] = await Promise.all([
      supabase.from("inventory_items").select("*").order("name"),
      supabase.from("maintenance_records").select("*").order("scheduled_date", { ascending: true }),
      supabase.from("consumables").select("*").order("name"),
    ]);

    if (assetsRes.data) setAssets(assetsRes.data as unknown as Asset[]);
    if (schedulesRes.data) setSchedules(schedulesRes.data as unknown as ServiceSchedule[]);
    if (consumablesRes.data) setConsumables(consumablesRes.data as unknown as Consumable[]);
    setLoading(false);
  };

  const handleSaveSchedule = async (formData: ServiceScheduleFormData) => {
    const { recurrence_interval, recurrence_unit, trigger_type, trigger_value, ...dbFields } = formData;
    void recurrence_interval; void recurrence_unit; void trigger_type; void trigger_value;
    const saveData = {
      ...dbFields,
      scheduled_date: new Date(formData.scheduled_date).toISOString(),
      consumables_used: formData.consumables_used as unknown as never,
      status: editingSchedule?.status ?? "scheduled",
    };

    if (editingSchedule) {
      const { error } = await supabase
        .from("maintenance_records")
        .update(saveData)
        .eq("id", editingSchedule.id);
      if (error) { toast.error("Failed to update schedule"); return; }
      toast.success("Schedule updated");
    } else {
      const { error } = await supabase
        .from("maintenance_records")
        .insert({ ...saveData, user_id: session!.user.id });
      if (error) { toast.error("Failed to create schedule"); return; }
      toast.success("Service scheduled");
    }
    setScheduleDialogOpen(false);
    setEditingSchedule(null);
    fetchAll();
  };

  const handleDeleteSchedule = async (id: string) => {
    const { error } = await supabase.from("maintenance_records").delete().eq("id", id);
    if (error) { toast.error("Failed to delete"); return; }
    toast.success("Schedule deleted");
    fetchAll();
  };

  const handleCompleteSchedule = async (id: string) => {
    const schedule = schedules.find((s) => s.id === id);
    if (schedule?.consumables_used && schedule.consumables_used.length > 0) {
      for (const cu of schedule.consumables_used as ConsumableUsage[]) {
        const consumable = consumables.find((c) => c.id === cu.consumable_id);
        if (consumable) {
          await supabase
            .from("consumables")
            .update({ quantity_in_stock: Math.max(0, consumable.quantity_in_stock - cu.quantity_used) })
            .eq("id", cu.consumable_id);
        }
      }
    }

    const { error } = await supabase
      .from("maintenance_records")
      .update({ status: "completed", completed_date: new Date().toISOString() })
      .eq("id", id);
    if (error) { toast.error("Failed to complete"); return; }
    toast.success("Service completed");
    fetchAll();
  };

  const handleSaveConsumable = async (formData: ConsumableFormData) => {
    if (editingConsumable) {
      const { error } = await supabase
        .from("consumables")
        .update(formData)
        .eq("id", editingConsumable.id);
      if (error) { toast.error("Failed to update consumable"); return; }
      toast.success("Consumable updated");
    } else {
      const { error } = await supabase
        .from("consumables")
        .insert({ ...formData, user_id: session!.user.id });
      if (error) { toast.error("Failed to create consumable"); return; }
      toast.success("Consumable added");
    }
    setConsumableDialogOpen(false);
    setEditingConsumable(null);
    fetchAll();
  };

  const handleDeleteConsumable = async (id: string) => {
    const { error } = await supabase.from("consumables").delete().eq("id", id);
    if (error) { toast.error("Failed to delete"); return; }
    toast.success("Consumable deleted");
    fetchAll();
  };

  const getAssetName = (assetId: string) => assets.find((a) => a.id === assetId)?.name || "";

  const overdueCount = schedules.filter(
    (s) => s.status === "scheduled" && new Date(s.scheduled_date) < new Date(),
  ).length;

  const scheduleStats = [
    { label: "Total Schedules", value: schedules.length, icon: CalendarDays, color: "text-primary" },
    { label: "Scheduled", value: schedules.filter((s) => s.status === "scheduled").length, icon: Clock, color: "text-sky-400" },
    { label: "In Progress", value: schedules.filter((s) => s.status === "in_progress").length, icon: Wrench, color: "text-amber-400" },
    { label: "Completed", value: schedules.filter((s) => s.status === "completed").length, icon: CheckCircle, color: "text-emerald-400" },
  ];

  const consumableStats = [
    { label: "Total Consumables", value: consumables.length, icon: Package, color: "text-primary" },
    { label: "Low Stock", value: consumables.filter((c) => c.min_quantity > 0 && c.quantity_in_stock <= c.min_quantity).length, icon: AlertTriangle, color: "text-amber-400" },
  ];

  const serviceTypes = [...new Set(schedules.map((s) => s.service_type).filter(Boolean))];
  const consumableCategories = [...new Set(consumables.map((c) => c.category).filter(Boolean))] as string[];

  const filteredSchedules = schedules.filter((s) => {
    if (!s.scheduled_date) return false;
    const isOverdue = s.status === "scheduled" && new Date(s.scheduled_date) < new Date();
    const displayStatus = isOverdue ? "overdue" : s.status;
    const q = search.toLowerCase();
    const matchesSearch =
      (s.title || "").toLowerCase().includes(q) ||
      getAssetName(s.asset_id).toLowerCase().includes(q) ||
      (s.service_type || "").toLowerCase().includes(q) ||
      (s.description || "").toLowerCase().includes(q);
    const matchesStatus = statusFilter === "all" || displayStatus === statusFilter;
    const matchesType = typeFilter === "all" || s.service_type === typeFilter;
    return matchesSearch && matchesStatus && matchesType;
  });

  const filteredConsumables = consumables.filter((c) => {
    const q = search.toLowerCase();
    const matchesSearch =
      c.name.toLowerCase().includes(q) ||
      (c.category || "").toLowerCase().includes(q);
    const matchesCategory = categoryFilter === "all" || c.category === categoryFilter;
    const matchesLowStock = !showLowStock || (c.min_quantity > 0 && c.quantity_in_stock <= c.min_quantity);
    return matchesSearch && matchesCategory && matchesLowStock;
  });

  if (!session) return null;

  return (
    <AppLayout>
      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate({ to: "/inventory" })}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <Wrench className="h-5 w-5 text-primary" />
          <h1 className="font-heading text-2xl font-bold">Service Scheduling</h1>
        </div>

        {activeTab === "schedules" ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {scheduleStats.map((s) => (
              <div key={s.label} className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{s.label}</span>
                  <s.icon className={`h-4 w-4 ${s.color}`} />
                </div>
                <span className="font-heading text-3xl font-bold">{s.value}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {consumableStats.map((s) => (
              <div key={s.label} className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{s.label}</span>
                  <s.icon className={`h-4 w-4 ${s.color}`} />
                </div>
                <span className="font-heading text-3xl font-bold">{s.value}</span>
              </div>
            ))}
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Overdue</span>
                <AlertTriangle className="h-4 w-4 text-red-400" />
              </div>
              <span className="font-heading text-3xl font-bold">{overdueCount}</span>
            </div>
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={activeTab === "schedules" ? "Search schedules..." : "Search consumables..."}
                className="pl-10"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className="flex gap-2 flex-wrap">
              {activeTab === "schedules" ? (
                <>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="rounded-md border border-border bg-card px-3 py-2 text-sm"
                  >
                    <option value="all">All Status</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="in_progress">In Progress</option>
                    <option value="completed">Completed</option>
                    <option value="overdue">Overdue</option>
                    <option value="cancelled">Cancelled</option>
                  </select>

                  <select
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                    className="rounded-md border border-border bg-card px-3 py-2 text-sm"
                  >
                    <option value="all">All Types</option>
                    {serviceTypes.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </>
              ) : (
                <>
                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="rounded-md border border-border bg-card px-3 py-2 text-sm"
                  >
                    <option value="all">All Categories</option>
                    {consumableCategories.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>

                  <Button
                    variant={showLowStock ? "default" : "outline"}
                    size="sm"
                    onClick={() => setShowLowStock(!showLowStock)}
                  >
                    <AlertTriangle className="h-4 w-4 mr-1" />
                    Low Stock
                  </Button>
                </>
              )}
            </div>

            <div className="flex gap-2">
              {activeTab === "schedules" && (
                <Button size="sm" variant="outline" onClick={() => {
                  if (schedules.length === 0) { toast.info("No schedules to export"); return; }
                  const headers = ["Title","Asset","Service Type","Status","Scheduled Date","Completed Date","Recurrence","Description","Notes"];
                  const escape = (v: string | null) => {
                    if (!v) return "";
                    const str = String(v).replace(/"/g, '""');
                    return str.includes(",") || str.includes("\n") || str.includes('"') ? `"${str}"` : str;
                  };
                  const rows = schedules.map((s) => [
                    escape(s.title),
                    escape(getAssetName(s.asset_id)),
                    escape(s.service_type),
                    escape(s.status),
                    escape(s.scheduled_date),
                    escape(s.completed_date),
                    escape(s.recurrence),
                    escape(s.description),
                    escape(s.notes),
                  ].join(","));
                  const csv = [headers.join(","), ...rows].join("\n");
                  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `service_schedules_${new Date().toISOString().split("T")[0]}.csv`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                  toast.success("Schedules exported to CSV");
                }}>
                  <Download className="h-4 w-4 mr-1" /> Export CSV
                </Button>
              )}
              {activeTab === "consumables" && (
                <Button size="sm" variant="outline" onClick={() => {
                  if (consumables.length === 0) { toast.info("No consumables to export"); return; }
                  const headers = ["Name","Category","Unit","Quantity in Stock","Min Quantity","Cost per Unit"];
                  const escape = (v: string | number | null) => {
                    if (v == null) return "";
                    const str = String(v).replace(/"/g, '""');
                    return str.includes(",") || str.includes("\n") || str.includes('"') ? `"${str}"` : str;
                  };
                  const rows = consumables.map((c) => [
                    escape(c.name), escape(c.category), escape(c.unit),
                    escape(c.quantity_in_stock), escape(c.min_quantity), escape(c.cost_per_unit),
                  ].join(","));
                  const csv = [headers.join(","), ...rows].join("\n");
                  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `consumables_${new Date().toISOString().split("T")[0]}.csv`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                  toast.success("Consumables exported to CSV");
                }}>
                  <Download className="h-4 w-4 mr-1" /> Export CSV
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => {
                  if (activeTab === "schedules") {
                    setEditingSchedule(null);
                    setScheduleDialogOpen(true);
                  } else {
                    setEditingConsumable(null);
                    setConsumableDialogOpen(true);
                  }
                }}
                className="shadow-glow font-semibold"
              >
                <Plus className="h-4 w-4 mr-1" />
                {activeTab === "schedules" ? "Schedule Service" : "Add Consumable"}
              </Button>
            </div>
          </div>

          <TabsList className="bg-muted">
            <TabsTrigger value="schedules" className="gap-1.5">
              <Wrench className="h-4 w-4" /> Schedules
            </TabsTrigger>
            <TabsTrigger value="consumables" className="gap-1.5">
              <Package className="h-4 w-4" /> Consumables
            </TabsTrigger>
          </TabsList>

          <TabsContent value="schedules" className="space-y-4">
            {loading ? (
              <div className="text-center text-muted-foreground py-20">Loading...</div>
            ) : (
              <ScheduleList
                schedules={filteredSchedules}
                assets={assets}
                onEdit={(s) => { setEditingSchedule(s); setScheduleDialogOpen(true); }}
                onDelete={handleDeleteSchedule}
                onComplete={handleCompleteSchedule}
              />
            )}
          </TabsContent>

          <TabsContent value="consumables" className="space-y-4">
            {loading ? (
              <div className="text-center text-muted-foreground py-20">Loading...</div>
            ) : (
              <ConsumableList
                consumables={filteredConsumables}
                onEdit={(c) => { setEditingConsumable(c); setConsumableDialogOpen(true); }}
                onDelete={handleDeleteConsumable}
              />
            )}
          </TabsContent>
        </Tabs>
      </main>

      <ScheduleDialog
        open={scheduleDialogOpen}
        onOpenChange={(open) => { setScheduleDialogOpen(open); if (!open) setEditingSchedule(null); }}
        onSave={handleSaveSchedule}
        schedule={editingSchedule}
        assets={assets}
        consumables={consumables}
      />

      <ConsumableDialog
        open={consumableDialogOpen}
        onOpenChange={(open) => { setConsumableDialogOpen(open); if (!open) setEditingConsumable(null); }}
        onSave={handleSaveConsumable}
        consumable={editingConsumable}
      />
    </AppLayout>
  );
}
