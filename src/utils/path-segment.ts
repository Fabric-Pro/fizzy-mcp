/**
 * A shared containment guard for the resource ids `FizzyClient` interpolates
 * into request paths — `board_id`, `card_number`, `comment_id`, `step_id`,
 * `reaction_id`, `user_id`, `column_id`, `notification_id` and `card_id`.
 *
 * Every one of those methods builds its path as `/${slug}/boards/${boardId}`
 * or similar, so an id that escapes its segment retargets the request exactly
 * the way an unguarded `account_slug` did before `normalizeAccountSlug` (see
 * `utils/account-slug.ts`): `..` reaches a different resource and `fetch`
 * resolves the dot segments away before the request is sent, so nothing
 * downstream ever sees the traversal; a `/` grafts extra segments on; a `?` or
 * `#` truncates the rest of the path into a query string or fragment. These
 * ids arrive as MCP tool arguments — model-supplied, not developer-supplied —
 * and the Cloudflare transport (`cloudflare/mcp-session.ts`) runs tool
 * arguments through no Zod validation at all, so this client is the only
 * enforcement point on that path.
 *
 * **This is a containment guard, not a per-id shape pin.** Confirmed against
 * upstream (`basecamp/fizzy`): every resource id is a base36-encoded UUIDv7,
 * exactly 25 characters from `[0-9a-z]`
 * (`lib/rails_ext/active_record_uuid_type.rb`; `boards_controller.rb`,
 * `cards/comments_controller.rb`, `cards/steps_controller.rb`,
 * `cards/comments/reactions_controller.rb`, `boards/columns_controller.rb`,
 * `users_controller.rb` and `notifications/readings_controller.rb` all do a
 * plain `.find(params[:id])` against that column), while a card is instead
 * looked up by `number` — a plain integer — because `cards_controller.rb`
 * calls `find_by!(number: params[:id])` and `Card#to_param` returns
 * `number.to_s`. Both shapes fit comfortably inside the charset below, so one
 * conservative pattern covers them without hard-coding either encoding into
 * {@link assertPathSegment}: pinning a resource-id shape would tie this client
 * to whatever upstream happens to use for ids today.
 *
 * Card slots are the one exception, and get {@link assertCardNumber} on top of
 * the containment guard. Every `/cards/:x` slot resolves by `number` —
 * including the one `getCard`/`updateCard`/`deleteCard` label `card_id` — and
 * Rails casts a leading-digit id to that integer column instead of rejecting
 * it, so an unpinned card slot reaches a different card rather than failing.
 * `config/routes.rb` places no constraint on any id segment, so upstream does
 * no shape checking of its own to fall back on.
 */

/** Characters a path segment interpolated into a Fizzy request URL may use. */
const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9._~-]+$/;

/**
 * Generous next to either real shape (a 25-character base36 id or a card
 * number a few digits long) and still short enough that a rejected value
 * never becomes a large error message.
 */
const MAX_PATH_SEGMENT_LENGTH = 256;

/**
 * Assert that `value` is safe to interpolate as a single path segment, and
 * return it unchanged.
 *
 * `name` is the MCP-facing argument name (`board_id`, `card_number`, …), used
 * only to name the argument in the thrown message — never the value itself,
 * which is not echoed back. These messages surface verbatim to the model, so
 * they say what to pass instead of just refusing.
 *
 * @throws Error if `value` is not a string at all, is empty, is `.` or `..`, is longer than
 *   {@link MAX_PATH_SEGMENT_LENGTH}, or contains anything outside
 *   `[A-Za-z0-9._~-]`. That excludes `/` and `\` (cannot introduce a segment
 *   of their own), `%` (cannot smuggle an encoded one), `?` and `#` (cannot
 *   truncate the path into a query string or fragment), and control
 *   characters — which is what matters, not what the charset admits.
 */
export function assertPathSegment(value: string, name: string): string {
  // `value` is typed `string`, but nothing guarantees it is one at runtime: the
  // Cloudflare transport dispatches raw MCP arguments with no Zod validation at
  // all (`cloudflare/mcp-session.ts`), so a tool that reads an id the caller
  // never sent hands this `undefined`. Checked before anything touches
  // `.length`, which would otherwise throw a bare "Cannot read properties of
  // undefined (reading 'length')" naming neither the tool nor the argument
  // (issue #96) — every other rejection below names the argument, and a missing
  // one is the most likely of the lot.
  if (typeof value !== "string") {
    throw new Error(`${name} is required and must be a Fizzy identifier`);
  }

  if (value.length > MAX_PATH_SEGMENT_LENGTH) {
    throw new Error(`${name} is too long to be a valid Fizzy identifier`);
  }

  // "" and ".." are caught before the charset test, which would accept both:
  // "." is legitimate inside an id, just not as the whole of one, and the
  // same reasoning normalizeAccountSlug applies to account_slug applies here.
  if (value === "" || value === "." || value === "..") {
    throw new Error(`${name} is required and must be a Fizzy identifier, not a path segment`);
  }

  if (!PATH_SEGMENT_PATTERN.test(value)) {
    throw new Error(
      `${name} contains characters that are not part of a Fizzy identifier. ` +
        `Pass the id exactly as the Fizzy API returned it — never a path, URL, or query string.`
    );
  }

  return value;
}

/** A card number: the plain integer shown on the board. */
const CARD_NUMBER_PATTERN = /^\d+$/;

/**
 * Assert that `value` is a card number, and return it unchanged.
 *
 * Every `/cards/:x` slot is resolved upstream by `find_by!(number: ...)`, and
 * Rails casts a string to that integer column by its leading digits. A
 * 25-character card id therefore does not 404 when it starts with digits —
 * and current ids do, since the base36 UUIDv7 encoding leads with the
 * timestamp: `03…` silently reads or writes card 3, which exists in any
 * account that kept its default onboarding cards. That is the wrong-card
 * comment from issue #5, and it reaches `updateCard` too, where it overwrites
 * the other card. Card slots are the one place where leaving the shape
 * unpinned (see the note above) misroutes a request instead of failing it.
 *
 * @throws Error under every condition {@link assertPathSegment} throws, or if
 *   `value` is anything but ASCII digits.
 */
export function assertCardNumber(value: string, name: string): string {
  assertPathSegment(value, name);

  if (!CARD_NUMBER_PATTERN.test(value)) {
    throw new Error(
      `${name} must be the card's number as shown on the board (e.g. 42), not its id. ` +
        `Fizzy looks cards up by number, so an id would address a different card. ` +
        `Use the "number" field from fizzy_get_cards.`
    );
  }

  return value;
}
