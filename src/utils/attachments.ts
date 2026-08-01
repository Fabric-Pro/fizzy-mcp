/**
 * Turning a tool call's arguments into the bytes Fizzy's direct-upload flow
 * needs, plus the ActionText markup that references the result.
 *
 * Validation lives here rather than in the Zod schema, for two reasons: the
 * Cloudflare transport executes raw arguments without Zod at all — the same
 * reason `parseCardsPage` in tools/handlers.ts validates by hand — and the
 * either/or rules cannot be expressed as Zod refinements without turning the
 * schema into a ZodEffects, which `McpServer.registerTool` publishes to stdio
 * clients as an empty property list. So this is the only place they live.
 */

import { base64ToBytes } from "./base64.js";
import { getLocalFileReader } from "./file-source.js";

/**
 * Upper bound on an attachment, applied to both input modes.
 *
 * Base64 inflates by ~4/3, so 10 MB of file is already a ~13.3 MB JSON-RPC
 * message — beyond this the transport, not the storage backend, is the real
 * limit, and a clear refusal beats a truncated frame.
 */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Extensions worth naming; anything else uploads as a generic download. */
const CONTENT_TYPES_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  pdf: "application/pdf",
  txt: "text/plain",
  log: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  zip: "application/zip",
  mp4: "video/mp4",
  mov: "video/quicktime",
};

const DEFAULT_CONTENT_TYPE = "application/octet-stream";

export interface ResolvedAttachment {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
}

/** Strip any directory component, handling both POSIX and Windows separators. */
function basename(path: string): string {
  const segments = path.split(/[/\\]/);
  return segments[segments.length - 1];
}

export function contentTypeForFilename(filename: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(filename);
  if (!match) return DEFAULT_CONTENT_TYPE;
  return CONTENT_TYPES_BY_EXTENSION[match[1].toLowerCase()] ?? DEFAULT_CONTENT_TYPE;
}

/**
 * The ActionText element that renders an uploaded blob inside a rich-text field.
 *
 * Takes the blob's **`attachable_sgid`**, not its `signed_id`: the two are both
 * signed tokens for the same blob but carry different purposes, and only the
 * attachable one resolves here. Passing `signed_id` produces a comment that
 * saves cleanly and then displays an unresolved-attachment placeholder.
 *
 * The value is a Rails signed global id and so carries no markup, but it is
 * escaped rather than trusted — it lands in an HTML attribute, where the cost
 * of being wrong is stored XSS.
 */
export function attachmentHtml(attachableSgid: string): string {
  const escaped = attachableSgid
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return `<action-text-attachment sgid="${escaped}"></action-text-attachment>`;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new Error(`${key} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Resolve `file_path` or `base64_data` into bytes plus the metadata the
 * direct-upload request needs.
 *
 * @throws Error with a message naming the argument at fault — these surface
 * verbatim to the model, so they have to say what to send instead.
 */
export async function resolveAttachment(
  args: Record<string, unknown>
): Promise<ResolvedAttachment> {
  const filePath = optionalString(args, "file_path");
  const base64Data = optionalString(args, "base64_data");
  const explicitFilename = optionalString(args, "filename");
  const explicitContentType = optionalString(args, "content_type");

  if (filePath && base64Data) {
    throw new Error("Provide either file_path or base64_data, not both");
  }

  let bytes: Uint8Array;
  let filename: string;

  if (filePath) {
    const readLocalFile = getLocalFileReader();
    if (!readLocalFile) {
      throw new Error(
        "file_path is only supported on the stdio transport, where the caller and the " +
          "server are the same user. Read the file yourself and pass base64_data with " +
          "filename instead."
      );
    }
    bytes = await readLocalFile(filePath);
    // basename either way: an explicit filename is no more trustworthy than a path.
    filename = basename(explicitFilename ?? filePath);
  } else if (base64Data) {
    if (!explicitFilename) {
      throw new Error("filename is required when uploading with base64_data");
    }
    // Bound passed through so the limit is enforced before the decode allocates,
    // not after: this path is reachable by remote callers on http/sse/Workers.
    bytes = base64ToBytes(base64Data, MAX_ATTACHMENT_BYTES);
    filename = basename(explicitFilename);
  } else {
    throw new Error(
      "Provide the file to upload as either file_path (stdio transport only) or base64_data"
    );
  }

  if (!filename) {
    throw new Error("Could not determine a filename for the upload");
  }
  if (bytes.length === 0) {
    throw new Error(`${filename} is empty — there is nothing to upload`);
  }
  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `${filename} is ${bytes.length} bytes, over the ${MAX_ATTACHMENT_BYTES}-byte upload limit`
    );
  }

  return {
    bytes,
    filename,
    contentType: explicitContentType ?? contentTypeForFilename(filename),
  };
}
