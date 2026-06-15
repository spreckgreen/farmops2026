import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Edit, Trash2, AlertTriangle } from "lucide-react";
import type { Asset } from "./types";

interface AssetTableProps {
  assets: Asset[];
  onEdit: (asset: Asset) => void;
  onDelete: (id: string) => void;
}

const statusColors: Record<string, string> = {
  available: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  in_use: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  maintenance: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  retired: "bg-red-500/15 text-red-400 border-red-500/30",
};

const AssetTable = ({ assets, onEdit, onDelete }: AssetTableProps) => {
  if (assets.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-20 border border-dashed border-border rounded-xl">
        <p className="text-lg mb-1">No assets found</p>
        <p className="text-sm">Add your first asset to get started</p>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">
                Category
              </th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">
                Location
              </th>
              <th className="text-center px-4 py-3 font-medium text-muted-foreground">Qty</th>
              <th className="text-center px-4 py-3 font-medium text-muted-foreground">Status</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">
                Barcode
              </th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden xl:table-cell">
                Tags
              </th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((asset) => {
              const minQ = asset.min_quantity ?? 0;
              const qty = asset.quantity ?? 0;
              const isLow = minQ > 0 && qty <= minQ;
              return (
                <tr
                  key={asset.id}
                  className="border-b border-border/50 hover:bg-muted/20 transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {isLow && (
                        <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                      )}
                      <div>
                        <div className="font-medium">{asset.name || "Unnamed"}</div>
                        {asset.description && (
                          <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                            {asset.description}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell text-muted-foreground">
                    {asset.category || "—"}
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground">
                    {asset.location || "—"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={isLow ? "text-amber-400 font-semibold" : ""}>{qty}</span>
                    {minQ > 0 && (
                      <span className="text-muted-foreground text-xs"> / {minQ}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Badge variant="outline" className={statusColors[asset.status] || ""}>
                      {(asset.status || "available").replace("_", " ")}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground font-mono text-xs">
                    {asset.barcode || "—"}
                  </td>
                  <td className="px-4 py-3 hidden xl:table-cell">
                    <div className="flex gap-1 flex-wrap">
                      {(asset.tags || []).slice(0, 3).map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                      {(asset.tags || []).length > 3 && (
                        <Badge variant="secondary" className="text-xs">
                          +{(asset.tags || []).length - 3}
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => onEdit(asset)}
                      >
                        <Edit className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => onDelete(asset.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AssetTable;
