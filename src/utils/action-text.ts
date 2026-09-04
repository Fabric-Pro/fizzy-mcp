/**
 * Structured metadata for the `<action-text-attachment>` elements embedded in a
 * rich-text HTML field.
 *
 * The API never reports a card's or comment's attachments as data. They exist
 * only as ActionText markup inside `description_html` / `body.html`, and the
 * matching plain-text rendering flattens each one to a bare `[filename.png]`
 * with no size, no dimensions and — crucially — no way to fetch the bytes. This
 * module turns that markup back into the fields `fizzy_get_attachment` needs.
 *
 * **No DOM parser.** Workers ships `HTMLRewriter` and Node does not; Node ships
 * neither `DOMParser` nor `HTMLRewriter`, and this module is reached from the
 * shared tool handlers, so it must run identically on both. What is left is
 * careful string scanning: quote-aware tag slicing rather than a single
 * `<action-text-attachment[^>]*>` regex, because an attribute value may legally
 * contain `>`.
 *
 * Nothing here throws. Rich text is user-authored content that has already made
 * a round trip through a database; a malformed attribute must cost the caller
 * that one field, never the whole `fizzy_get_card` response.
 */

/**
 * One `<action-text-attachment>` element, as much of it as the markup actually
 * carried. Every field is optional because every attribute is: ActionText omits
 * `width`/`height` for non-images, and a remote or half-migrated attachment can
 * be missing any of the rest.
 */
export interface ActionTextAttachment {
  filename?: string;
  content_type?: string;
  byte_size?: number;
  width?: number;
  height?: number;
  /**
   * The blob's ActiveStorage signed id, lifted out of the `url` attribute's
   * path. This is what `fizzy_get_attachment` takes — the tool rebuilds the
   * whole path from it server-side and never fetches `url` itself.
   */
  signed_id?: string;
  /** Absolute URL of the full-resolution blob. Reported for humans, never fetched. */
  url?: string;
  /** Absolute URL of the resized preview variant, when the markup carried one. */
  preview_url?: string;
  /**
   * The signed variation token out of `preview_url`'s path. Pass it to
   * `fizzy_get_attachment` as `variation` to fetch the preview instead of the
   * full-resolution original — typically a fraction of the bytes for a
   * screenshot, at the resolution a model actually needs.
   */
  preview_variation?: string;
}

/**
 * Cap on elements parsed out of a single field.
 *
 * A rich-text field is already bounded by the API response that carried it, so
 * this is not the primary defence — it is a stop on the scan doing unbounded
 * work if a field ever arrives with pathological markup. Well past any real
 * card: cards observed in practice carry single-digit attachment counts.
 */
const MAX_ATTACHMENTS_PER_FIELD = 200;

/**
 * Opening tag, matched case-insensitively and only where the element name
 * actually ends — the lookahead is what stops this from also matching a
 * hypothetical `<action-text-attachment-group>`.
 *
 * A regex does the *search* rather than `indexOf` over a lowercased copy,
 * because `toLowerCase()` is not length-preserving for every Unicode input, so
 * indices taken from a lowercased copy cannot be used to slice the original.
 */
const OPEN_TAG_PATTERN = /<action-text-attachment(?=[\s/>])/gi;

/** Closing tag, used only to bound the element's inner markup. */
const CLOSE_TAG_PATTERN = /<\/action-text-attachment\s*>/gi;

/** `name="value"`, `name='value'`, or an unquoted value. */
const ATTRIBUTE_PATTERN =
  /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;

/** Any `src=` / `href=` inside the element's inner markup (the `<figure>` body). */
const INNER_URL_PATTERN = /\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

/** `…/rails/active_storage/blobs/{redirect|proxy}/<signed_id>/<filename>` */
const BLOB_PATH_PATTERN =
  /\/rails\/active_storage\/blobs\/(?:redirect|proxy)\/([^/?#]+)\//;

/** `…/rails/active_storage/representations/{redirect|proxy}/<signed_id>/<variation>/<filename>` */
const REPRESENTATION_PATH_PATTERN =
  /\/rails\/active_storage\/representations\/(?:redirect|proxy)\/([^/?#]+)\/([^/?#]+)\//;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/**
 * Decode the entity references an HTML attribute value can carry.
 *
 * One pass, so `&amp;lt;` decodes to the literal text `&lt;` rather than being
 * decoded twice into `<`. Unrecognised references are left verbatim, which is
 * what a browser does with them too.
 */
function decodeEntities(value: string): string {
  if (!value.includes("&")) return value;
  return value.replace(
    /&(#[0-9]+|#[xX][0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]*);/g,
    (whole, reference: string) => {
      if (reference[0] === "#") {
        const isHex = reference[1] === "x" || reference[1] === "X";
        const code = Number.parseInt(
          isHex ? reference.slice(2) : reference.slice(1),
          isHex ? 16 : 10
        );
        // Lone surrogates and out-of-range code points throw in fromCodePoint.
        if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole;
        if (code >= 0xd800 && code <= 0xdfff) return whole;
        return String.fromCodePoint(code);
      }
      return NAMED_ENTITIES[reference.toLowerCase()] ?? whole;
    }
  );
}

/**
 * Index of the `>` that closes the tag opened at `start`, or -1 when the markup
 * is truncated.
 *
 * Quote-aware on purpose: `<action-text-attachment caption="a > b" …>` is legal
 * markup, and `[^>]*` would cut the tag in half at the caption.
 */
function findTagEnd(html: string, start: number): number {
  let quote: string | null = null;
  for (let i = start; i < html.length; i++) {
    const char = html[i];
    if (quote !== null) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return i;
    }
  }
  return -1;
}

/** Parse a tag's attribute text into a lowercase-keyed, entity-decoded map. */
function parseAttributes(attributeText: string): Map<string, string> {
  const attributes = new Map<string, string>();
  ATTRIBUTE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTRIBUTE_PATTERN.exec(attributeText)) !== null) {
    const name = match[1].toLowerCase();
    // First spelling wins, matching how browsers treat a duplicated attribute.
    if (attributes.has(name)) continue;
    attributes.set(name, decodeEntities(match[2] ?? match[3] ?? match[4] ?? ""));
  }
  return attributes;
}

/** The first non-empty value among `names`, trimmed, or undefined. */
function attribute(
  attributes: Map<string, string>,
  ...names: string[]
): string | undefined {
  for (const name of names) {
    const value = attributes.get(name);
    if (value !== undefined && value.trim() !== "") return value.trim();
  }
  return undefined;
}

/**
 * A non-negative integer attribute, or undefined when it is absent or is not
 * one. ActionText writes these as plain decimal strings; anything else is
 * treated as missing rather than coerced, so a caller never sees `NaN`.
 */
function integerAttribute(
  attributes: Map<string, string>,
  name: string
): number | undefined {
  const raw = attribute(attributes, name);
  if (raw === undefined || !/^[0-9]+$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : undefined;
}

/**
 * Resolve a possibly-relative URL against the client's configured base URL.
 *
 * ActionText writes the `url` attribute as an account-scoped *path*, so this is
 * what makes the result usable at all. The base URL comes from the client's
 * config and is never hardcoded, so a self-hosted or staging Fizzy resolves
 * against itself.
 *
 * Restricted to http/https: an attribute is authored content, and a
 * `javascript:` or `data:` value resolves perfectly well through `new URL`
 * while being something no caller should be handed as "the attachment's URL".
 */
function absoluteUrl(raw: string | undefined, baseUrl: string): string | undefined {
  if (raw === undefined) return undefined;
  try {
    const resolved = new URL(raw, baseUrl);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      return undefined;
    }
    return resolved.toString();
  } catch {
    return undefined;
  }
}

/**
 * The element's inner markup: everything between this tag and whichever comes
 * first, its closing tag or the next attachment's opening tag. Taking the
 * earlier of the two keeps an unclosed element from swallowing its successors'
 * previews.
 */
function innerMarkup(html: string, contentStart: number, nextOpenIndex: number): string {
  CLOSE_TAG_PATTERN.lastIndex = contentStart;
  const close = CLOSE_TAG_PATTERN.exec(html);
  const closeIndex = close === null ? html.length : close.index;
  const boundary = nextOpenIndex === -1 ? closeIndex : Math.min(closeIndex, nextOpenIndex);
  return html.slice(contentStart, boundary);
}

/** The first `src`/`href` in the element's body that points at a variant. */
function findRepresentationUrl(inner: string): string | undefined {
  INNER_URL_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INNER_URL_PATTERN.exec(inner)) !== null) {
    const value = decodeEntities(match[1] ?? match[2] ?? "");
    if (REPRESENTATION_PATH_PATTERN.test(value)) return value;
  }
  return undefined;
}

/**
 * Extract `{filename, content_type, byte_size, width, height, signed_id, url,
 * preview_url, preview_variation}` for every attachment in a rich-text HTML
 * field.
 *
 * @param html The `description_html` / `body.html` value. Anything that is not
 * a non-empty string yields `[]`, so callers can pass a field the `Fizzy*`
 * interfaces do not model without checking its type first.
 * @param baseUrl The client's configured base URL, used to absolutize the
 * account-scoped paths ActionText writes.
 */
export function parseActionTextAttachments(
  html: unknown,
  baseUrl: string
): ActionTextAttachment[] {
  if (typeof html !== "string" || html === "") return [];

  const results: ActionTextAttachment[] = [];
  OPEN_TAG_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = OPEN_TAG_PATTERN.exec(html)) !== null) {
    if (results.length >= MAX_ATTACHMENTS_PER_FIELD) break;

    const attributesStart = match.index + match[0].length;
    const tagEnd = findTagEnd(html, attributesStart);
    if (tagEnd === -1) break; // Truncated markup: nothing further is parseable.

    // Resume the outer scan past this tag, then look ahead for the next opening
    // tag so the inner markup can be bounded without a second full pass.
    OPEN_TAG_PATTERN.lastIndex = tagEnd + 1;
    const lookahead = new RegExp(OPEN_TAG_PATTERN.source, "gi");
    lookahead.lastIndex = tagEnd + 1;
    const next = lookahead.exec(html);

    const attributes = parseAttributes(html.slice(attributesStart, tagEnd));
    const inner = innerMarkup(html, tagEnd + 1, next === null ? -1 : next.index);

    const rawUrl = attribute(attributes, "url", "href");
    const rawPreviewUrl = findRepresentationUrl(inner);

    const attachment: ActionTextAttachment = {};

    const filename = attribute(attributes, "filename");
    if (filename !== undefined) attachment.filename = filename;

    const contentType = attribute(attributes, "content-type", "content_type");
    if (contentType !== undefined) attachment.content_type = contentType;

    const byteSize = integerAttribute(attributes, "filesize");
    if (byteSize !== undefined) attachment.byte_size = byteSize;

    const width = integerAttribute(attributes, "width");
    if (width !== undefined) attachment.width = width;

    const height = integerAttribute(attributes, "height");
    if (height !== undefined) attachment.height = height;

    // The signed id is read out of the blob path first and the representation
    // path second: both carry the same blob token, but only some attachments
    // have a preview, and a remote image has neither.
    const signedId =
      (rawUrl !== undefined ? BLOB_PATH_PATTERN.exec(rawUrl)?.[1] : undefined) ??
      (rawPreviewUrl !== undefined
        ? REPRESENTATION_PATH_PATTERN.exec(rawPreviewUrl)?.[1]
        : undefined);
    if (signedId !== undefined) attachment.signed_id = signedId;

    const url = absoluteUrl(rawUrl, baseUrl);
    if (url !== undefined) attachment.url = url;

    if (rawPreviewUrl !== undefined) {
      const previewUrl = absoluteUrl(rawPreviewUrl, baseUrl);
      if (previewUrl !== undefined) {
        attachment.preview_url = previewUrl;
        const variation = REPRESENTATION_PATH_PATTERN.exec(rawPreviewUrl)?.[2];
        if (variation !== undefined) attachment.preview_variation = variation;
      }
    }

    // An element that yielded nothing at all is markup this parser does not
    // understand; reporting `{}` would be worse than reporting nothing.
    if (Object.keys(attachment).length > 0) results.push(attachment);
  }

  return results;
}
