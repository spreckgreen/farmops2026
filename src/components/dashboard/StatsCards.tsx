import { Package, CheckCircle, AlertTriangle, Wrench } from "lucide-react";

interface StatsCardsProps {
  total: number;
  available: number;
  inUse: number;
  lowStock: number;
}

const StatsCards = ({ total, available, inUse, lowStock }: StatsCardsProps) => {
  const stats = [
    { label: "Total Assets", value: total, icon: Package, color: "text-primary" },
    { label: "Available", value: available, icon: CheckCircle, color: "text-emerald-400" },
    { label: "In Use", value: inUse, icon: Wrench, color: "text-sky-400" },
    { label: "Low Stock", value: lowStock, icon: AlertTriangle, color: "text-amber-400" },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((s) => (
        <div key={s.label} className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
              {s.label}
            </span>
            <s.icon className={`h-4 w-4 ${s.color}`} />
          </div>
          <span className="font-heading text-3xl font-bold">{s.value}</span>
        </div>
      ))}
    </div>
  );
};

export default StatsCards;
