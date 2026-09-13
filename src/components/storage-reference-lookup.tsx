import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { STORAGE_REFERENCE, storageReferenceMatches } from "@/lib/storage-reference";

const GROUP_LABELS = {
  building: "Building",
  fixture: "Rack / fixture",
  subdivision: "Shelf / subdivision",
  container: "Movable container",
  container_top: "Container top",
} as const;

export function StorageReferenceLookup({
  title = "Storage and component reference",
}: {
  title?: string;
}) {
  const [query, setQuery] = useState("");
  const rows = useMemo(() => storageReferenceMatches(query), [query]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Build a physical location from building → fixture → shelf/drawer → position.
          Movable containers keep their own stable ID and separately record home and current location.
        </p>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find FS, rack, shelf, drawer, bag, TOP-R…"
          aria-label="Search storage reference"
        />
        <div className="max-h-80 overflow-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted text-left">
              <tr><th className="px-3 py-2">Type</th><th className="px-3 py-2">Code</th>
              <th className="px-3 py-2">Meaning</th><th className="px-3 py-2">Example</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.group}:${row.code}`} className="border-t align-top">
                  <td className="px-3 py-2"><Badge variant="outline">{GROUP_LABELS[row.group]}</Badge></td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono font-medium">{row.code}</td>
                  <td className="px-3 py-2"><span className="font-medium">{row.label}</span>
                    <p className="text-xs text-muted-foreground">{row.description}</p></td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{row.example}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length ? <p className="p-4 text-sm text-muted-foreground">No matching reference code.</p> : null}
        </div>
        <p className="text-xs text-muted-foreground">
          Example path: <span className="font-mono">FS-R001-S05-L</span>. A bag stored there remains
          <span className="font-mono"> BAG-0027</span> after it moves.
        </p>
      </CardContent>
    </Card>
  );
}
