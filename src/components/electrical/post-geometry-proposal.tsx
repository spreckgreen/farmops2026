// Perimeter post geometry — proposal for owner review.
//
// Read-only. It shows the derived position of every post in the frozen clockwise
// scheme, with the derivation behind each one. While the proposal is unconfirmed,
// post-only field observations stay unplotted on the Grid Map.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  POST_GEOMETRY_CONFIRMED,
  POST_GEOMETRY_REVIEW_NOTE,
  POST_GEOMETRY_VERSION,
  PROPOSED_POST_POSITIONS,
} from "@/lib/electrical-grid-post-geometry";

export function PostGeometryProposal() {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">
          Perimeter post positions{" "}
          <span className="font-normal text-muted-foreground">
            ({PROPOSED_POST_POSITIONS.length} posts ·{" "}
            {POST_GEOMETRY_CONFIRMED ? "confirmed" : "proposed, awaiting confirmation"})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <p className="text-muted-foreground">{POST_GEOMETRY_REVIEW_NOTE}</p>
        <p className="text-muted-foreground">
          Derived from the corrected 60 × 40 ft outline and the frozen clockwise post
          sequence: the four recorded corner posts (01NE, 06SE, 14SW, 19NW) are fixed, and
          the posts between two corners are spaced evenly along that wall — 8.0 ft on the
          east and west walls, 7.5 ft on the north and south walls. No new measurement is
          introduced. Geometry version {POST_GEOMETRY_VERSION}.
        </p>
        <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide derived positions" : "Show derived positions"}
        </Button>
        {open ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="py-1 pr-3">Post</th>
                  <th className="py-1 pr-3">Wall</th>
                  <th className="py-1 pr-3">X ft E</th>
                  <th className="py-1 pr-3">Y ft S</th>
                  <th className="py-1">Basis</th>
                </tr>
              </thead>
              <tbody>
                {PROPOSED_POST_POSITIONS.map((p) => (
                  <tr key={p.ref} className="border-b last:border-0 align-top">
                    <td className="py-1 pr-3 font-mono">{p.ref}</td>
                    <td className="py-1 pr-3">
                      {p.wall}
                      {p.corner ? " (corner)" : ""}
                    </td>
                    <td className="py-1 pr-3 font-mono">{p.xFt}</td>
                    <td className="py-1 pr-3 font-mono">{p.yFt}</td>
                    <td className="py-1 text-muted-foreground">{p.basis}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
