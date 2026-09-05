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
 * this client. Pinning a shape instead would tie this client to whatever
 * upstream happens to use for ids today, and `card_id` in particular has no
 * single shape to pin regardless: `getCard`/`updateCard`/`deleteCard` build
 * `/cards/:id` from whatever the caller labels `card_id`, but the route on
 * the other end resolves that slot by `number`, not by id (see
 * `utils/card-resolver.ts`, which bridges exactly that gap for the tools that
 * accept either). This module takes no position on which shape belongs there;
 * it only keeps whatever value arrives inside a single, inert path segment.
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
 * @throws Error if `value` is empty, is `.` or `..`, is longer than
 *   {@link MAX_PATH_SEGMENT_LENGTH}, or contains anything outside
 *   `[A-Za-z0-9._~-]`. That excludes `/` and `\` (cannot introduce a segment
 *   of their own), `%` (cannot smuggle an encoded one), `?` and `#` (cannot
 *   truncate the path into a query string or fragment), and control
 *   characters — which is what matters, not what the charset admits.
 */
export function assertPathSegment(value: string, name: string): string {
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
