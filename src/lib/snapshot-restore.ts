import type { Snapshot } from "./admin.functions";
import {
  normalizeIntegrityEnvelope,
  verifyIntegrity,
  type IntegrityEnvelope,
} from "./snapshot-integrity";

export type RestoreParseDebugInfo = {
  stage: "local-file-parse";
  request: {
    sentToServer: false;
    reason: string;
  };
  file?: {
    name?: string;
    sizeBytes?: number;
    textLength: number;
    lastModified?: number;
  };
  parser: {
    message: string;
    position?: number;
    line?: number;
    column?: number;
  };
  diagnostics: {
    firstNonWhitespaceChar?: string;
    lastNonWhitespaceChar?: string;
    startsLikeJson: boolean;
    looksLikeHtml: boolean;
    looksTruncated: boolean;
    openCurly: number;
    closeCurly: number;
    openBracket: number;
    closeBracket: number;
    excerptAroundError?: string;
    fileStart: string;
    fileEnd: string;
  };
};

export type RestoreIntegrityStatus =
  | { kind: "verified"; algo: string; value: string }
  | { kind: "missing" }
  | { kind: "mismatch"; reason: string; expected: string; actual: string };

export type ParseRestoreSnapshotResult =
  | {
      ok: true;
      snapshot: Snapshot;
      integrity: RestoreIntegrityStatus;
      totalRows: number;
    }
  | {
      ok: false;
      message: string;
      integrity?: RestoreIntegrityStatus;
      debug?: RestoreParseDebugInfo;
    };

export type ParseRestoreSnapshotOptions = {
  fileName?: string;
  fileSize?: number;
  lastModified?: number;
};

function snapshotPayload(snapshot: Snapshot) {
  return { app: snapshot.app, version: snapshot.version, tables: snapshot.tables };
}

function stripBom(text: string) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function stripMarkdownFence(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : text;
}

function repairCommonJsonText(text: string) {
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/,\s*}/g, "}")
    .replace(/,\s*]/g, "]");
}

function parseErrorPosition(message: string): number | undefined {
  const match = message.match(/position\s+(\d+)/i);
  return match ? Number(match[1]) : undefined;
}

function lineColumnAt(text: string, position?: number) {
  if (position === undefined || Number.isNaN(position)) return {};
  const before = text.slice(0, Math.max(0, position));
  const lines = before.split(/\r\n|\r|\n/);
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

function countChar(text: string, char: string) {
  let count = 0;
  for (let i = 0; i < text.length; i++) if (text[i] === char) count++;
  return count;
}

function makeParseDebug(
  rawText: string,
  parsedText: string,
  err: Error,
  options?: ParseRestoreSnapshotOptions,
): RestoreParseDebugInfo {
  const trimmed = parsedText.trim();
  const position = parseErrorPosition(err.message);
  const { line, column } = lineColumnAt(parsedText, position);
  const openCurly = countChar(parsedText, "{");
  const closeCurly = countChar(parsedText, "}");
  const openBracket = countChar(parsedText, "[");
  const closeBracket = countChar(parsedText, "]");
  const around =
    position === undefined
      ? undefined
      : parsedText.slice(Math.max(0, position - 160), Math.min(parsedText.length, position + 160));
  const looksTruncated =
    /unexpected end|unterminated|end of json/i.test(err.message) ||
    openCurly !== closeCurly ||
    openBracket !== closeBracket ||
    /(?:\.\.\.|…|\[truncated\])\s*$/i.test(trimmed);

  return {
    stage: "local-file-parse",
    request: {
      sentToServer: false,
      reason: "The snapshot failed JSON parsing in the browser before any restore request was sent.",
    },
    file: {
      name: options?.fileName,
      sizeBytes: options?.fileSize ?? rawText.length,
      textLength: rawText.length,
      lastModified: options?.lastModified,
    },
    parser: {
      message: err.message,
      position,
      line,
      column,
    },
    diagnostics: {
      firstNonWhitespaceChar: trimmed[0],
      lastNonWhitespaceChar: trimmed[trimmed.length - 1],
      startsLikeJson: trimmed.startsWith("{") || trimmed.startsWith("["),
      looksLikeHtml: /^\s*</.test(parsedText),
      looksTruncated,
      openCurly,
      closeCurly,
      openBracket,
      closeBracket,
      excerptAroundError: around,
      fileStart: parsedText.slice(0, 240),
      fileEnd: parsedText.slice(Math.max(0, parsedText.length - 240)),
    },
  };
}

function parseMessage(debug: RestoreParseDebugInfo) {
  const { parser, diagnostics } = debug;
  const location = parser.line && parser.column ? ` at line ${parser.line}, column ${parser.column}` : "";
  if (diagnostics.looksLikeHtml) {
    return `Could not parse file${location}: this looks like an HTML page, not a JSON snapshot.`;
  }
  if (diagnostics.looksTruncated) {
    return `Could not parse file${location}: JSON appears truncated or incomplete (${parser.message}). Re-download the snapshot and try again.`;
  }
  return `Could not parse file${location}: ${parser.message}`;
}

export async function parseRestoreSnapshotJson(
  text: string,
  options?: ParseRestoreSnapshotOptions,
): Promise<ParseRestoreSnapshotResult> {
  let parsed: unknown;
  const cleaned = stripMarkdownFence(stripBom(text));
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    try {
      parsed = JSON.parse(repairCommonJsonText(cleaned));
    } catch {
      const error = err instanceof Error ? err : new Error(String(err));
      const debug = makeParseDebug(text, cleaned, error, options);
      return { ok: false, message: parseMessage(debug), debug };
    }
  }

  if (!parsed || typeof parsed !== "object") {
    return { ok: false, message: "Could not parse file: snapshot must be a JSON object." };
  }

  const snapshot = parsed as Snapshot;
  if (snapshot.app !== "bostead" || snapshot.version !== 1) {
    return { ok: false, message: "This file is not a Bostead v1 snapshot." };
  }
  if (!Array.isArray(snapshot.tables)) {
    return { ok: false, message: "Snapshot is missing the 'tables' array." };
  }

  const payload = snapshotPayload(snapshot);
  const rawIntegrity = (parsed as { integrity?: unknown }).integrity;
  const normalizedIntegrity = normalizeIntegrityEnvelope(rawIntegrity, payload);
  let integrity: RestoreIntegrityStatus;

  if (normalizedIntegrity) {
    let verdict: Awaited<ReturnType<typeof verifyIntegrity>>;
    try {
      verdict = await verifyIntegrity(payload, normalizedIntegrity as IntegrityEnvelope);
    } catch (err) {
      return {
        ok: false,
        message: `Could not verify snapshot integrity: ${(err as Error).message}.`,
      };
    }

    if (verdict.ok) {
      integrity = {
        kind: "verified",
        algo: normalizedIntegrity.algo,
        value: normalizedIntegrity.value,
      };
    } else {
      integrity = {
        kind: "mismatch",
        reason: verdict.reason,
        expected: verdict.expected,
        actual: verdict.actual,
      };
      return {
        ok: false,
        message: "Snapshot integrity check failed — see details below.",
        integrity,
      };
    }
  } else {
    integrity = { kind: "missing" };
  }

  const totalRows = snapshot.tables.reduce((n, t) => n + (t.rows?.length ?? 0), 0);
  return { ok: true, snapshot, integrity, totalRows };
}