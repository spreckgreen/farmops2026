// Pull the first balanced JSON object out of arbitrary model text.
// Small local models often wrap JSON in prose or markdown fences, so every
// structured-output call in the app funnels its raw text through this.
export function extractJsonObject(text: string): unknown | null {
  const cleaned = String(text ?? "").replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * True when the provider rejected the request because the *model* can't do
 * JSON/structured output — e.g. OpenAI's legacy `gpt-4` returns
 * "Invalid parameter: 'response_format' of type 'json_object' is not supported
 * with this model". These calls must be retried as plain text, not escalated.
 */
export function isStructuredOutputUnsupported(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  return (
    msg.includes("response_format") ||
    msg.includes("json_schema") ||
    (msg.includes("json") && msg.includes("not supported"))
  );
}
