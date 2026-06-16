import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Consumable } from "@/types/scheduling";
import { Edit, Trash2, Package } from "lucide-react";

interface ConsumableListProps {
  consumables: Consumable[];
  onEdit: (consumable: Consumable) => void;
  onDelete: (id: string) => void;
}

const ConsumableList = ({ consumables, onEdit, onDelete }: ConsumableListProps) => {
  if (consumables.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-16">
        <Package className="h-10 w-10 mx-auto mb-3 opacity-40" />
        <p>No consumables tracked yet</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30 hover:bg-muted/30">
            <TableHead>Name</TableHead>
            <TableHead>Category</TableHead>
            <TableHead className="text-right">In Stock</TableHead>
            <TableHead className="text-right">Min Qty</TableHead>
            <TableHead className="text-right">Cost/Unit</TableHead>
            <TableHead className="w-20" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {consumables.map((c) => {
            const lowStock = c.min_quantity > 0 && c.quantity_in_stock <= c.min_quantity;
            return (
              <TableRow key={c.id}>
                <TableCell className="font-medium">
                  {c.name}
                  <span className="text-muted-foreground text-xs ml-1">({c.unit})</span>
                </TableCell>
                <TableCell>{c.category || "—"}</TableCell>
                <TableCell className="text-right">
                  {lowStock ? (
                    <Badge variant="destructive" className="text-xs">{c.quantity_in_stock}</Badge>
                  ) : (
                    c.quantity_in_stock
                  )}
                </TableCell>
                <TableCell className="text-right">{c.min_quantity}</TableCell>
                <TableCell className="text-right">${(c.cost_per_unit || 0).toFixed(2)}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(c)}>
                      <Edit className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => onDelete(c.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
};

export default ConsumableList;
