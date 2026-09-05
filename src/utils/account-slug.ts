/**
 * Normalization and validation for the `account_slug` argument every tool takes.
 *
 * The slug is interpolated straight into a request path (`/${slug}/cards/…`),
 * so a slug that escapes its segment moves the request somewhere else: `..`
 * reaches the parent path (and `fetch` resolves the dot segments away before
 * the request is sent, so nothing downstream sees the traversal), a slug
 * containing `/` grafts extra segments on, and a `?` or `#` truncates the rest
 * of the path into a query string or fragment. Fizzy would reject most of the
 * resulting paths, but "the server happens to 404" is not a boundary — the
 * client should refuse to build the request at all.
 *
 * The slug is not the only caller-supplied value interpolated into a path —
 * `cardId`, `boardId`, `commentId` and the rest are too, and are still
 * unguarded. That is a wider change than this module: those ids have no single
 * agreed shape, so pinning one risks rejecting real ids and breaking every tool
 * for that resource. This covers the value every account-scoped path starts
 * with, which is all of them but `/my/identity`.
 *
 * This lives in its own module because both callers are load-bearing and
 * neither owns the rule: client/fizzy-client.ts applies it to every endpoint,
 * and utils/attachments.ts applies it on the read path that fetches with the
 * bearer token attached. They used to disagree — the client only stripped a
 * leading slash — which meant the narrower check protected exactly one method.
 */

/** Characters a real Fizzy account slug is built from. */
const ACCOUNT_SLUG_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * Normalize an account slug to the single path segment used in request paths.
 *
 * Strips the leading `/` that Fizzy's own responses carry (identity returns
 * slugs like `/123456`, and callers pass those straight back), then rejects
 * anything that is not a bare segment.
 *
 * @throws if the slug is empty, is `.` or `..`, or contains anything outside
 *   `[A-Za-z0-9._-]`.
 */
export function normalizeAccountSlug(value: string): string {
  const slug = value.startsWith("/") ? value.slice(1) : value;

  // `.` and `..` are caught before the charset test, which would accept both:
  // the dot is legitimate inside a slug, just not as the whole of one.
  if (slug === "" || slug === "." || slug === "..") {
    throw new Error("account_slug is required and must be an account slug");
  }

  if (!ACCOUNT_SLUG_PATTERN.test(slug)) {
    throw new Error(
      "account_slug must be an account slug such as '123456', not a path or URL"
    );
  }

  return slug;
}
