import { MAX_ATTACHMENT_BYTES, isInlineableImage } from "./attachments.js";

export function parseInlineLimit(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must contain only decimal digits`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > MAX_ATTACHMENT_BYTES) {
    throw new Error(`${name} must be a positive safe integer no larger than ${MAX_ATTACHMENT_BYTES}`);
  }
  return parsed;
}

let limits: { text: number; binary: number } | Error = { text: 1048576, binary: 524288 };
export function setInlineContentLimits(text?: string, binary?: string): void {
  try {
    limits = {
      text: parseInlineLimit(text, "FIZZY_MAX_INLINE_TEXT_BYTES", 1048576),
      binary: parseInlineLimit(binary, "FIZZY_MAX_INLINE_BINARY_BYTES", 524288),
    };
  } catch (error) {
    limits = error as Error;
  }
}
export function getInlineContentLimits(): { text: number; binary: number } {
  if (limits instanceof Error) throw limits;
  return limits;
}
export function isTextContentType(type: string): boolean {
  const media = type.split(";")[0].trim().toLowerCase();
  return media.startsWith("text/") || /^application\/(?:json|xml|[^;\s]+\+(?:json|xml))$/.test(media);
}

// Separate from the upload map: these types describe inline text interpretation.
const INLINE_TEXT_TYPES_BY_EXTENSION = new Map<string, string>([
  ["txt", "text/plain"],
  ["log", "text/plain"],
  ["md", "text/markdown"],
  ["markdown", "text/markdown"],
  ["csv", "text/csv"],
  ["tsv", "text/tab-separated-values"],
  ["json", "application/json"],
  ["xml", "application/xml"],
  ["yaml", "text/yaml"],
  ["yml", "text/yaml"],
]);

export function classifyInlineContent(contentType: string, filename: string): {
  kind: "image" | "text" | "binary";
  mimeType: string;
} {
  const media = contentType.split(";")[0].trim().toLowerCase();
  if (isInlineableImage(media)) return { kind: "image", mimeType: contentType };
  let effectiveType = contentType;
  if (media === "application/octet-stream" || media === "") {
    const extension = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
    effectiveType = INLINE_TEXT_TYPES_BY_EXTENSION.get(extension) ?? contentType;
  }
  return {
    kind: isTextContentType(effectiveType) ? "text" : "binary",
    mimeType: effectiveType || "application/octet-stream",
  };
}
