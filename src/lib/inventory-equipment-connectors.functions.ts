import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const inputSchema = z.object({
  manufacturer: z.string().trim().min(1).max(120),
  model: z.string().trim().min(1).max(160),
});

const confidenceSchema = z.enum(["high", "medium", "low"]);
const directionSchema = z.enum(["input", "output", "bidirectional"]);
const signalSchema = z.enum(["rf", "data", "power", "display", "audio", "control", "other"]);
const genderSchema = z.enum(["male", "female", "plug", "receptacle", "genderless"]);
const polaritySchema = z.enum(["standard", "reverse", "not_applicable"]);

export interface EquipmentPortProposal {
  id: string;
  selected: boolean;
  name: string;
  direction: z.infer<typeof directionSchema>;
  signal_type: z.infer<typeof signalSchema>;
  connector_type_id: string;
  connector_display_name: string;
  connector_gender: z.infer<typeof genderSchema>;
  polarity: z.infer<typeof polaritySchema>;
  protocol: string | null;
  impedance_ohms: number | null;
  notes: string | null;
  source_url: string;
  source_title: string;
  evidence: string;
  confidence: z.infer<typeof confidenceSchema>;
  review_status: "proposed";
}

export interface EquipmentPortDiscovery {
  manufacturer: string;
  model: string;
  exact_model_match: boolean;
  sources: Array<{ title: string; url: string; snippet: string }>;
  proposals: EquipmentPortProposal[];
  warnings: string[];
  model_id: string;
}

const decodeHtml = (value: string) =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function unwrapDuckDuckGoUrl(value: string): string {
  try {
    const url = new URL(decodeHtml(value), "https://duckduckgo.com");
    const redirected = url.searchParams.get("uddg");
    return redirected ? decodeURIComponent(redirected) : url.href;
  } catch {
    return "";
  }
}

function safePublicUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function parseEquipmentSearchResults(html: string) {
  const blocks = html.match(/<div[^>]+class="[^"]*result[^"]*"[^>]*>[\s\S]*?<\/div>\s*<\/div>/gi) ?? [];
  return blocks
    .map((block) => {
      const anchor = block.match(/class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!anchor) return null;
      const url = safePublicUrl(unwrapDuckDuckGoUrl(anchor[1]));
      if (!url) return null;
      const snippetMatch = block.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\//i);
      return {
        title: decodeHtml(anchor[2]).slice(0, 240),
        url,
        snippet: decodeHtml(snippetMatch?.[1] ?? "").slice(0, 700),
      };
    })
    .filter((row): row is { title: string; url: string; snippet: string } => Boolean(row))
    .filter((row, index, rows) => rows.findIndex((candidate) => candidate.url === row.url) === index)
    .slice(0, 8);
}

async function searchEquipment(manufacturer: string, model: string) {
  const query = `"${manufacturer}" "${model}" manual connectors ports specifications`;
  const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { "user-agent": "FarmOps equipment documentation lookup/1.0" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Documentation search failed (HTTP ${response.status}).`);
  return parseEquipmentSearchResults(await response.text());
}

export const discoverEquipmentPorts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => inputSchema.parse(value))
  .handler(async ({ data, context }): Promise<EquipmentPortDiscovery> => {
    const sources = await searchEquipment(data.manufacturer, data.model);
    if (!sources.length) {
      return {
        manufacturer: data.manufacturer,
        model: data.model,
        exact_model_match: false,
        sources: [],
        proposals: [],
        warnings: ["No public documentation results were found. Add ports manually or retry with the exact model variant."],
        model_id: "",
      };
    }

    const { data: connectorRows, error } = await context.supabase
      .from("connector_types")
      .select("id,family,display_name,description,aliases,mating_key")
      .eq("active", true)
      .order("family")
      .order("display_name");
    if (error) throw new Error(error.message);

    const connectors = connectorRows ?? [];
    const connectorIds = new Set(connectors.map((connector) => String(connector.id)));
    const sourceUrls = new Set(sources.map((source) => source.url));

    const { resolveAreaAi } = await import("./ai-routing.server");
    const ai = await resolveAreaAi("procedures", {
      hostedDefaultModel: "google/gemini-3.6-flash",
      client: context.supabase,
    });
    const { generateText, Output, NoObjectGeneratedError } = await import("ai");

    const outputSchema = z.object({
      exact_model_match: z.boolean(),
      warnings: z.array(z.string()),
      ports: z.array(z.object({
        name: z.string(),
        direction: directionSchema,
        signal_type: signalSchema,
        connector_type_id: z.string(),
        connector_gender: genderSchema,
        polarity: polaritySchema,
        protocol: z.string().nullable(),
        impedance_ohms: z.number().positive().nullable(),
        notes: z.string().nullable(),
        source_url: z.string().url(),
        source_title: z.string(),
        evidence: z.string(),
        confidence: confidenceSchema,
      })),
    });

    const prompt = [
      `EQUIPMENT: ${data.manufacturer} ${data.model}`,
      "",
      "ALLOWED CONNECTOR CATALOG (connector_type_id must exactly match one id):",
      ...connectors.map((connector) =>
        `- ${connector.id}: ${connector.display_name}; aliases=${(connector.aliases ?? []).join(", ")}; ${connector.description ?? ""}`,
      ),
      "",
      "SEARCH RESULTS:",
      ...sources.map((source, index) =>
        `[${index + 1}] ${source.title}\nURL: ${source.url}\nSNIPPET: ${source.snippet || "(no snippet)"}`,
      ),
    ].join("\n");

    type ModelOutput = z.infer<typeof outputSchema>;
    const system =
      "Extract equipment ports for review; never invent them. Use only explicit evidence in the supplied search results. " +
      "Every port must cite one supplied source_url and an evidence phrase. Reject the whole variant as exact_model_match=false " +
      "when the manufacturer/model is not explicitly supported. Omit ambiguous ports. Use low confidence for snippet-only evidence. " +
      "Do not treat a cable included in a package as a device port. Return at most 30 ports.";

    const attempt = async (attemptPrompt: string): Promise<ModelOutput | null> => {
      try {
        const response = await generateText({
          model: ai.provider(ai.modelId),
          output: Output.object({ schema: outputSchema }),
          system,
          prompt: attemptPrompt,
        });
        return response.output;
      } catch (error) {
        if (NoObjectGeneratedError.isInstance(error)) return null;
        throw error;
      }
    };

    let output = await attempt(prompt);
    if (!output) {
      output = await attempt(
        prompt +
          "\n\nRETRY REQUIREMENT: Return one JSON object with exactly these top-level keys: " +
          "exact_model_match (boolean), warnings (string array), ports (array). " +
          "Every port must include every requested field; use null for unknown protocol, impedance_ohms, and notes. " +
          "Use only enum values and connector_type_id values listed above.",
      );
    }

    if (!output) {
      return {
        manufacturer: data.manufacturer,
        model: data.model,
        exact_model_match: false,
        sources,
        proposals: [],
        warnings: [
          "The documentation search completed, but the configured AI model returned an invalid result twice.",
          "No ports were created. Retry the lookup or select a more capable model for Procedures & manual generation in AI Settings.",
        ],
        model_id: ai.modelId,
      };
    }

    const proposals = output.ports
      .filter((port) => connectorIds.has(port.connector_type_id) && sourceUrls.has(port.source_url))
      .slice(0, 30)
      .map((port, index): EquipmentPortProposal => ({
        id: `proposal-${index + 1}`,
        selected: port.confidence === "high",
        name: port.name.slice(0, 120),
        direction: port.direction,
        signal_type: port.signal_type,
        connector_type_id: port.connector_type_id,
        connector_display_name:
          String(connectors.find((connector) => connector.id === port.connector_type_id)?.display_name ?? port.connector_type_id),
        connector_gender: port.connector_gender,
        polarity: port.polarity,
        protocol: port.protocol?.slice(0, 160) ?? null,
        impedance_ohms: port.impedance_ohms,
        notes: port.notes?.slice(0, 500) ?? null,
        source_url: port.source_url,
        source_title: port.source_title.slice(0, 240),
        evidence: port.evidence.slice(0, 500),
        confidence: port.confidence,
        review_status: "proposed",
      }));

    return {
      manufacturer: data.manufacturer,
      model: data.model,
      exact_model_match: output.exact_model_match,
      sources,
      proposals: output.exact_model_match ? proposals : [],
      warnings: [
        ...output.warnings.slice(0, 10),
        ...(proposals.some((proposal) => proposal.confidence !== "high")
          ? ["Medium- and low-confidence results require explicit selection before creation."]
          : []),
      ],
      model_id: ai.modelId,
    };
  });
