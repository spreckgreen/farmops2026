// Shared helper text for stable-ID fields. Everything it renders comes from the
// centralized standards metadata — no naming rule is duplicated here.
import {
  INFRASTRUCTURE_ID_STANDARDS,
  describeInfrastructureId,
  isInfrastructureIdKind,
} from "@/lib/electrical-standards-registry";
import { HIERARCHICAL_ID_SHAPES } from "@/lib/electrical";

export function StableIdHelp({ kind, value }: { kind: string; value: string }) {
  if (isInfrastructureIdKind(kind)) {
    const std = INFRASTRUCTURE_ID_STANDARDS[kind];
    const reading = describeInfrastructureId(kind, value);
    return (
      <div className="space-y-1 text-xs text-muted-foreground">
        {std.formats.map((format) => (
          <div key={format.shape}>
            <span className="font-medium">{format.name}:</span>{" "}
            <span className="font-mono">{format.shape}</span> — e.g.{" "}
            <span className="font-mono">{format.examples.join(", ")}</span>
            <ul className="ml-4 list-disc">
              {format.tokens.map((t) => (
                <li key={t.token}>
                  <span className="font-mono">{t.token}</span> — {t.meaning}
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p>
          {std.assignment === "user-assigned" ? "User-assigned" : "System-generated"}.{" "}
          {std.assignmentNote}
        </p>
        <p>{std.stabilityNote}</p>
        {reading ? (
          <p>
            <span className="font-mono">{value.trim().toUpperCase()}</span> reads as: {reading}.
          </p>
        ) : null}
      </div>
    );
  }
  const shape = HIERARCHICAL_ID_SHAPES[kind];
  return (
    <p className="text-xs text-muted-foreground">
      {shape ? (
        <>
          Required format <span className="font-mono">{shape}</span>.{" "}
        </>
      ) : null}
      Stable IDs never change once assigned — they carry no physical attributes.
    </p>
  );
}
