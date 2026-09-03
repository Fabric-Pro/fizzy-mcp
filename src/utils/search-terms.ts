/**
 * Splits a `search` string into the separate `terms[]` elements that make
 * `fizzy_get_cards` require every word (search_mode="all").
 *
 * Upstream `Filter#cards` ANDs separate `terms[]` elements but OR-matches the
 * words inside one element, so sending one element per word turns the API's
 * broad recall query into an every-word-must-match query.
 *
 * Two classes of word must be dropped first. Fizzy's hosted backend is MySQL
 * with the InnoDB full-text defaults, and an element that consists solely of a
 * built-in stopword or of a word shorter than `innodb_ft_min_token_size` (3)
 * matches nothing at all, which would zero the whole AND. Verified live on
 * 2026-09-02: "the", "to", "with", "for" and "ab" each return 0 cards on their
 * own, while "and" (not on the list) returns every card.
 */

/** InnoDB's built-in full-text stopword list (INNODB_FT_DEFAULT_STOPWORD). */
export const INNODB_STOPWORDS: ReadonlySet<string> = new Set([
  "a", "about", "an", "are", "as", "at", "be", "by", "com", "de", "en", "for",
  "from", "how", "i", "in", "is", "it", "la", "of", "on", "or", "that", "the",
  "this", "to", "was", "what", "when", "where", "who", "will", "with", "und", "www",
]);

/** InnoDB's default `innodb_ft_min_token_size`. */
export const MIN_SEARCH_TOKEN_LENGTH = 3;

export interface SearchTerms {
  /** Words sent to the API, one `terms[]` element each, in input order. */
  terms: string[];
  /** Words dropped because the full-text index cannot match them. */
  ignored: string[];
}

export function splitSearchTerms(search: string): SearchTerms {
  // Mirror the upstream pipeline: Search::Query#sanitize turns every character
  // outside Ruby's ASCII \w ([A-Za-z0-9_]) except `"` into a space, and
  // Search::Stemmer then replaces the quotes too before the MATCH, so the words
  // the index actually sees are the [A-Za-z0-9_] runs.
  const words = search.split(/[^A-Za-z0-9_]+/).filter((word) => word.length > 0);
  const terms: string[] = [];
  const ignored: string[] = [];
  const seen = new Set<string>();
  for (const word of words) {
    // Matching is case-insensitive upstream, so "Card" and "card" are one term.
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (key.length < MIN_SEARCH_TOKEN_LENGTH || INNODB_STOPWORDS.has(key)) {
      ignored.push(word);
    } else {
      terms.push(word);
    }
  }
  return { terms, ignored };
}
