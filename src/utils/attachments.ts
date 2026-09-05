/**
 * Turning a tool call's arguments into the bytes Fizzy's direct-upload flow
 * needs and the ActionText markup that references the result, plus the reverse
 * direction: validating the arguments that name an attachment to read back.
 *
 * Validation lives here rather than in the Zod schema, for two reasons: the
 * Cloudflare transport executes raw arguments without Zod at all — the same
 * reason `parsePage` in tools/handlers.ts validates by hand — and the
 * either/or rules cannot be expressed as Zod refinements without turning the
 * schema into a ZodEffects, which `McpServer.registerTool` publishes to stdio
 * clients as an empty property list. So this is the only place they live.
 *
 * For the read direction that reasoning is not a convenience, it is the
 * security boundary: the tokens validated below are interpolated into a URL
 * path that is then fetched with the caller's Fizzy credential attached, and
 * the Workers path would otherwise reach that fetch with no validation at all.
 */

import type { AttachmentRef } from "../client/types.js";
import { normalizeAccountSlug } from "./account-slug.js";
import { base64ToBytes, maxEncodedLength } from "./base64.js";
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
  // Guard on the raw value before optionalString trims it: .trim() copies the
  // whole string, so an over-cap base64_data must be rejected before that copy,
  // not after — the same reasoning base64ToBytes applies to its own input.
  const rawBase64Data = args.base64_data;
  if (
    typeof rawBase64Data === "string" &&
    rawBase64Data.length > maxEncodedLength(MAX_ATTACHMENT_BYTES)
  ) {
    throw new Error(
      `base64_data is over the ${MAX_ATTACHMENT_BYTES}-byte upload limit`
    );
  }

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

// ============ Reading an attachment back ============

/**
 * Upper bound on an image inlined into a tool response as an MCP `image`
 * content block.
 *
 * Deliberately well below {@link MAX_ATTACHMENT_BYTES}. The upload direction
 * spends its budget once, on a frame the client already holds in memory; an
 * inlined image is base64 in the response *and* then decoded, re-encoded and
 * charged as vision tokens by whatever model receives it. 3 MB of image is a
 * ~4 MB base64 payload, which stays inside the 5 MB per-image ceiling the
 * Anthropic Messages API applies — the practical limit long before any
 * transport's.
 *
 * A full-resolution screenshot over this is not truncated: the caller is told
 * to re-request it with the `variation` token from the attachment's
 * `preview_variation`, which is what they wanted anyway.
 */
export const MAX_INLINE_IMAGE_BYTES = 3 * 1024 * 1024;

/**
 * The image media types worth returning as an MCP `image` content block.
 *
 * Narrower than `image/*` on purpose. The set is what vision models actually
 * decode; handing back an `image/svg+xml` or `image/tiff` block produces a
 * client-side error rather than a picture, and a caller is better served by
 * being told the type is not renderable than by a failed response. Anything
 * outside this set is reported as metadata instead.
 */
const INLINEABLE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

/** Whether an attachment of this media type can be returned as an image block. */
export function isInlineableImage(contentType: string): boolean {
  return INLINEABLE_IMAGE_TYPES.has(contentType.toLowerCase());
}

/**
 * Characters a Rails signed id or an ActiveStorage variation token can contain.
 *
 * Both are URL-safe base64 payloads joined to a hex digest by `--`, so the
 * alphabet is deliberately narrow. What matters is not what it admits but what
 * it excludes: `/` and `\` cannot appear, so a token can never introduce a path
 * segment of its own, and `%` cannot appear, so it cannot smuggle an encoded
 * one either. `.` is admitted because it is legal in the alphabet, and the
 * traversal it would otherwise enable is closed by rejecting a token that is
 * exactly `.` or `..` — without a separator, no other spelling traverses.
 */
const SIGNED_TOKEN_PATTERN = /^[A-Za-z0-9_.~=+-]+$/;

/**
 * Generous next to a real signed id (a few hundred characters) and still short
 * enough that a rejected token never becomes a multi-kilobyte error message.
 */
const MAX_SIGNED_TOKEN_LENGTH = 4096;

/** Arguments that would name a URL rather than a blob. See {@link parseAttachmentRequest}. */
const URL_SHAPED_ARGUMENTS = ["url", "preview_url", "blob_url", "attachment_url", "src"];

/**
 * An attachment to read back, with every component already validated: the
 * client's {@link AttachmentRef} plus the account it belongs to.
 */
export interface AttachmentRequest extends AttachmentRef {
  accountSlug: string;
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${key} is required and must be a non-empty string`);
  }
  return value.trim();
}

/**
 * Validate one opaque signed token destined for a URL path segment.
 *
 * @throws Error naming the argument — these surface verbatim to the model.
 */
function validateSignedToken(value: string, key: string): string {
  if (value.length > MAX_SIGNED_TOKEN_LENGTH) {
    throw new Error(`${key} is too long to be a signed id`);
  }
  if (value === "." || value === "..") {
    throw new Error(`${key} must be a signed id, not a path`);
  }
  if (!SIGNED_TOKEN_PATTERN.test(value)) {
    throw new Error(
      `${key} contains characters that are not part of a signed id. ` +
        `Pass the 'signed_id' (or 'preview_variation') exactly as fizzy_get_card ` +
        `reported it — never a URL or a file path.`
    );
  }
  return value;
}

/**
 * Validate the download filename.
 *
 * Only ever used as the last path segment, where ActiveStorage treats it as
 * decoration for the Content-Disposition header rather than as part of the
 * lookup — but it is still caller-controlled text spliced into a path, so it
 * has to be a single segment. `/`, `\` and a `..` segment are rejected outright
 * rather than escaped away, so a traversal attempt fails loudly instead of
 * silently fetching something else.
 */
function validateAttachmentFilename(value: string): string {
  if (value.length > 255) {
    throw new Error("filename is too long");
  }
  if (value.includes("/") || value.includes("\\")) {
    throw new Error(
      "filename must be a single file name, not a path — it cannot contain / or \\"
    );
  }
  if (value === "." || value === "..") {
    throw new Error("filename must be a file name, not a path segment");
  }
  // Escaped, not written literally: a raw NUL in source is invisible in review.
  if (/[\x00-\x1f\x7f]/.test(value)) {
    throw new Error("filename contains control characters");
  }
  return value;
}

/**
 * Resolve the arguments of `fizzy_get_attachment` into a validated request.
 *
 * **The tool never accepts a URL.** A caller-supplied URL fetched with the
 * user's Fizzy token attached is a server-side request forgery with a
 * credential on it, so the address is rebuilt server-side from a signed blob id
 * instead. A URL-shaped argument is rejected explicitly rather than ignored:
 * the Zod path would silently strip it and the Workers path would silently
 * carry it, and in both cases a model that thinks it asked for one URL and
 * quietly got another is worse off than one that gets an error saying so.
 *
 * @throws Error with a message naming the argument at fault — these surface
 * verbatim to the model, so they have to say what to send instead.
 */
export function parseAttachmentRequest(
  args: Record<string, unknown>
): AttachmentRequest {
  const supplied = URL_SHAPED_ARGUMENTS.filter((key) => args[key] !== undefined);
  if (supplied.length > 0) {
    throw new Error(
      `fizzy_get_attachment does not take a URL (${supplied.join(", ")}). ` +
        `Pass the attachment's 'signed_id' and 'filename' — from fizzy_get_card or ` +
        `fizzy_get_card_comments with include_attachments=true — and the address is ` +
        `rebuilt server-side.`
    );
  }

  // Pinned to a single path segment: this slug ends up in a URL that is fetched
  // with the caller's bearer token attached and whose body is streamed back to
  // the model. See utils/account-slug.ts.
  const accountSlug = normalizeAccountSlug(requiredString(args, "account_slug"));
  const signedId = validateSignedToken(requiredString(args, "signed_id"), "signed_id");
  const filename = validateAttachmentFilename(requiredString(args, "filename"));

  const rawVariation = args.variation;
  let variation: string | undefined;
  if (rawVariation !== undefined && rawVariation !== null) {
    if (typeof rawVariation !== "string") {
      throw new Error("variation must be a string");
    }
    const trimmed = rawVariation.trim();
    if (trimmed !== "") {
      variation = validateSignedToken(trimmed, "variation");
    }
  }

  return { accountSlug, signedId, filename, variation };
}
