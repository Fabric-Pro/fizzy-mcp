/**
 * Response projections for `fields: "summary"` on the three list tools whose
 * `"full"` payloads are dominated by fields most callers never look at:
 * fizzy_get_cards (description/description_html), fizzy_get_card_comments
 * (body.html duplicating body.plain_text, plus a repeated creator/card per
 * row), and fizzy_get_notifications (a full embedded card + creator object
 * per row). See tools/handlers.ts for how these are wired into the tools.
 *
 * `"full"` (the default) is an untouched passthrough — byte-for-byte
 * identical to pre-`fields` behavior. `"summary"` is strictly opt-in.
 *
 * The live API returns many fields the `Fizzy*` interfaces in
 * client/types.ts do not model — confirmed present on real responses:
 * `description_html`, `board`, `golden`, `closed`, `postponed`,
 * `last_active_at`, `has_attachments`, `has_more_assignees`, `image_url`,
 * `comments_url`, `reactions_url`, `unread_count`, `source_type`,
 * `board_name`, and `column.color` as an object `{name, value}` rather than
 * the `string` the type claims. So these summarizers operate structurally on
 * `Record<string, unknown>` and pick keys defensively, never relying on the
 * declared interfaces being complete or correct.
 */

export type FieldsMode = "summary" | "full";

/**
 * Parse the optional `fields` argument shared by fizzy_get_cards,
 * fizzy_get_card_comments, fizzy_get_notifications, and fizzy_get_pins.
 *
 * This has to exist (not just live in the zod schema) because the Cloudflare
 * transport executes raw args with no zod validation — mirrors the reasoning
 * behind `parseCardsPage` in tools/handlers.ts, and for the same reason: a
 * bad value must fail loudly here rather than silently falling through to
 * `"full"` on one transport and a zod error on the other.
 */
export function parseFieldsMode(value: unknown): FieldsMode {
  if (value === undefined) return "full";
  if (value === "summary" || value === "full") return value;
  throw new Error(`fields must be "summary" or "full", got: ${JSON.stringify(value)}`);
}

type Obj = Record<string, unknown>;

function isPlainObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Copy `keys` from `source`, omitting any that are absent or explicitly `undefined`. */
function pick(source: Obj, keys: readonly string[]): Obj {
  const out: Obj = {};
  for (const key of keys) {
    if (source[key] !== undefined) {
      out[key] = source[key];
    }
  }
  return out;
}

/** Reduce a nested object-valued field to `{id, name}`; `undefined` when the source isn't an object. */
function toIdName(value: unknown): Obj | undefined {
  if (!isPlainObject(value)) return undefined;
  return pick(value, ["id", "name"]);
}

/** Reduce a nested object-valued field to `{id, title}`; `undefined` when the source isn't an object. */
function toIdTitle(value: unknown): Obj | undefined {
  if (!isPlainObject(value)) return undefined;
  return pick(value, ["id", "title"]);
}

const CARD_SCALAR_KEYS = [
  "id",
  "number",
  "title",
  "status",
  "url",
  "due_on",
  "created_at",
  "updated_at",
  "last_active_at",
  "closed",
  "postponed",
  "golden",
  "has_attachments",
  // Kept even though the summary also carries `assignees`: the API truncates that
  // list and sets this flag, so dropping it would make a partial list read as the
  // complete set of assignees — exactly the kind of wrong conclusion a triaging
  // caller would draw from a summary.
  "has_more_assignees",
] as const;

/** Longest `description_preview` emitted by `summarizeCard`, in UTF-16 code units. */
const DESCRIPTION_PREVIEW_LIMIT = 200;

/**
 * Truncate to `limit` code units, appending `…`, without splitting a surrogate
 * pair. Cutting between the two halves of an astral character (an emoji) would
 * emit a lone surrogate — still valid JSON once escaped, but a malformed
 * character for whoever renders the preview.
 */
function truncatePreview(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const lastUnit = text.charCodeAt(limit - 1);
  const isHighSurrogate = lastUnit >= 0xd800 && lastUnit <= 0xdbff;
  return `${text.slice(0, isHighSurrogate ? limit - 1 : limit)}…`;
}

/**
 * Project a card down to the fields a browsing/searching caller needs.
 * Drops `description`, `description_html`, `comments_url`, `reactions_url`,
 * and `image_url`; adds `description_preview` (first 200 chars of the
 * plain-text `description`, `…`-truncated, omitted when there is none).
 */
export function summarizeCard(card: Obj): Obj {
  const out = pick(card, CARD_SCALAR_KEYS);

  const board = toIdName(card.board);
  if (board) out.board = board;

  const column = toIdName(card.column);
  if (column) out.column = column;

  const creator = toIdName(card.creator);
  if (creator) out.creator = creator;

  if (Array.isArray(card.assignees)) {
    out.assignees = card.assignees.map(toIdName).filter((a): a is Obj => a !== undefined);
  }

  if (Array.isArray(card.tags)) {
    // Card tags arrive as plain title strings, not objects: fizzy's
    // cards/_card.json.jbuilder serializes them as
    // `json.tags card.tags.pluck(:title).sort`. Routing those through
    // toIdTitle mapped every one to undefined, so summary mode reported
    // every tagged card as untagged. Object-shaped tags are still reduced,
    // in case the serializer ever grows ids.
    out.tags = card.tags
      .map((tag) => (typeof tag === "string" ? tag : toIdTitle(tag)))
      .filter((t): t is string | Obj => t !== undefined);
  }

  const description = card.description;
  if (typeof description === "string" && description.length > 0) {
    out.description_preview = truncatePreview(description, DESCRIPTION_PREVIEW_LIMIT);
  }

  return out;
}

/**
 * Project a comment down to the fields a discussion reader needs. Keeps
 * `body` as an object shaped `{ plain_text }` — never a bare string — so the
 * `body.plain_text` access path is identical in both modes; see
 * client/types.ts:80-90 on why treating this as a string yields
 * "[object Object]". Drops `body.html`, the repeated `card` object, and
 * `reactions_url`. Comment bodies are never truncated: a discussion is what
 * the caller asked for.
 */
export function summarizeComment(comment: Obj): Obj {
  const out = pick(comment, ["id", "created_at", "updated_at", "url"]);

  const creator = toIdName(comment.creator);
  if (creator) out.creator = creator;

  if (isPlainObject(comment.body) && comment.body.plain_text !== undefined) {
    out.body = { plain_text: comment.body.plain_text };
  }

  return out;
}

const NOTIFICATION_CARD_KEYS = [
  "id",
  "number",
  "title",
  "status",
  "url",
  "closed",
  "postponed",
  "board_name",
] as const;

/**
 * Project a notification down to the fields needed to triage it. Reduces the
 * embedded `card` to `{id, number, title, status, url, closed, postponed,
 * board_name}` — dropping the nested `card.column` object and everything
 * else — and `creator` to `{id, name}`.
 */
export function summarizeNotification(notification: Obj): Obj {
  const out = pick(notification, [
    "id",
    "title",
    "body",
    "read",
    "read_at",
    "created_at",
    "url",
    "unread_count",
  ]);

  const creator = toIdName(notification.creator);
  if (creator) out.creator = creator;

  if (isPlainObject(notification.card)) {
    out.card = pick(notification.card, NOTIFICATION_CARD_KEYS);
  }

  return out;
}
