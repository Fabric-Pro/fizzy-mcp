/**
 * Card Number Resolution Utility
 *
 * Shared logic for resolving card_id to card_number.
 * Used by both the standard server and Cloudflare Durable Objects paths.
 *
 * The Fizzy API has inconsistent identifier requirements:
 * - Card CRUD operations use `card_id` (internal identifier)
 * - Comment/step/action operations use `card_number` (visible number like #11)
 *
 * This utility bridges that gap by accepting either identifier.
 */

/**
 * Interface for the card lookup function.
 * This allows the resolver to work with any client that can fetch cards.
 */
export interface CardLookup {
  getCard(accountSlug: string, cardId: string): Promise<{
    number?: number;
    url?: string;
  }>;
}

/**
 * Resolve a card identifier to its card number.
 *
 * @param lookup - Object with getCard method (e.g., FizzyClient)
 * @param accountSlug - The account slug
 * @param cardId - The internal card ID (optional if cardNumber provided)
 * @param cardNumber - The visible card number (optional if cardId provided)
 * @returns The resolved card number as a string
 * @throws Error if neither identifier provided or resolution fails
 *
 * @example
 * // Using card_number directly (no API call)
 * const num = await resolveCardNumber(client, "/123", undefined, "15");
 *
 * @example
 * // Resolving card_id to card_number (fetches card)
 * const num = await resolveCardNumber(client, "/123", "card-abc", undefined);
 */
export async function resolveCardNumber(
  lookup: CardLookup,
  accountSlug: string,
  cardId?: string,
  cardNumber?: string
): Promise<string> {
  // If card_number is provided, use it directly (no API call needed)
  if (cardNumber) {
    return cardNumber;
  }

  // card_id is required if card_number wasn't provided
  if (!cardId) {
    throw new Error("card_id or card_number is required");
  }

  // Fetch the card to get its number
  const card = await lookup.getCard(accountSlug, cardId);

  // Try to get number from the card's number field
  if (card.number !== undefined && card.number !== null) {
    return String(card.number);
  }

  // Fallback: extract number from the card URL
  // URL format: https://app.fizzy.do/{account}/cards/{number}
  const urlMatch = card.url?.match(/\/cards\/(\d+)/);
  if (urlMatch) {
    return urlMatch[1];
  }

  throw new Error(`Unable to resolve card number for card_id ${cardId}`);
}

/**
 * Pick the identifier for the card-CRUD endpoints, which accept either
 * `card_id` or `card_number` under whichever name the caller used.
 *
 * Unlike {@link resolveCardNumber} this makes no API call, because there is
 * nothing to resolve: `GET`/`PUT`/`DELETE /:account_slug/cards/:id` looks the
 * card up by its `number`, not by an id — upstream's `cards_controller.rb`
 * does `find_by!(number: params[:id])` and `Card#to_param` returns
 * `number.to_s` (see `utils/path-segment.ts`). Both argument names therefore
 * address the same path slot, and whichever arrives is passed through
 * untouched.
 *
 * `card_id` wins when both are given, so a caller that was already passing it
 * keeps the exact request it had before the alias existed.
 *
 * The alias exists because 24 of the card tools take `card_number` while these
 * three took only `card_id`: a model that had just called
 * `fizzy_toggle_card_tag` would send `card_number` here too, and the undefined
 * id then reached `assertPathSegment` as a bare TypeError (issue #96).
 *
 * @throws Error if neither identifier is supplied.
 */
export function selectCardIdentifier(
  cardId?: string,
  cardNumber?: string
): string {
  const selected = cardId ?? cardNumber;

  // Enforced here rather than in the Zod schema because the Cloudflare
  // transport runs no Zod validation at all — so this is the only check both
  // transports share — and because under Zod 3 a `.refine()` made the schema a
  // ZodEffects and blanked out every published field (see the note on
  // commentCardSelectorBase in tools/schemas.ts).
  if (selected === undefined) {
    throw new Error("card_id or card_number is required");
  }

  return selected;
}
