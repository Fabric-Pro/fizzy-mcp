/**
 * Shared Tool Handlers
 *
 * Single source of truth for all tool handler logic.
 * Used by both the standard server and Cloudflare Durable Objects paths.
 *
 * Each handler returns the raw result - the calling code is responsible
 * for wrapping it in the appropriate MCP response format.
 */

import type { FizzyClient } from "../client/fizzy-client.js";
import {
  COLUMN_COLORS,
  type ColumnColor,
  type CardListOptions,
  type FizzyCard,
} from "../client/types.js";
import { resolveCardNumber } from "../utils/card-resolver.js";
import { splitSearchTerms, type SearchTerms } from "../utils/search-terms.js";
import { parseActionTextAttachments } from "../utils/action-text.js";
import {
  attachmentHtml,
  isInlineableImage,
  parseAttachmentRequest,
  resolveAttachment,
  MAX_INLINE_IMAGE_BYTES,
} from "../utils/attachments.js";
import { bytesToBase64 } from "../utils/base64.js";
import { FizzyAttachmentTooLargeError } from "../utils/errors.js";
import {
  parseFieldsMode,
  summarizeCard,
  summarizeComment,
  summarizeNotification,
} from "../utils/projections.js";

/**
 * Tool handler result - either data to serialize or a success message
 */
export type HandlerResult = unknown;

/**
 * A block of an MCP tool response, for the handlers that need to return
 * something other than serialized JSON.
 */
export type McpContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

/**
 * A handler result that is already MCP content rather than data to serialize.
 *
 * Both transports format a handler's return value the same way — a string
 * verbatim, anything else as pretty-printed JSON in a single `text` block — and
 * that is right for every tool but one. `fizzy_get_attachment` has to emit an
 * `image` block, which no amount of JSON in a text block substitutes for: the
 * point of the tool is that the model can *see* the screenshot. Rather than
 * teaching each transport about that tool, handlers can return this marker and
 * both formatters pass its blocks straight through.
 */
export interface McpContentResult {
  mcp_content: McpContentBlock[];
}

/** Wrap MCP content blocks so the transports forward them unchanged. */
export function mcpContent(blocks: McpContentBlock[]): McpContentResult {
  return { mcp_content: blocks };
}

function isMcpContentBlock(value: unknown): value is McpContentBlock {
  if (typeof value !== "object" || value === null) return false;
  const block = value as Record<string, unknown>;
  if (block.type === "text") return typeof block.text === "string";
  if (block.type === "image") {
    return typeof block.data === "string" && typeof block.mimeType === "string";
  }
  return false;
}

/**
 * Whether a handler result is pre-formatted MCP content.
 *
 * Every block is shape-checked, not just the marker key. An API response that
 * happened to carry an `mcp_content` array would otherwise be reinterpreted as
 * content blocks and silently lose its data; requiring each element to be a
 * well-formed block makes that collision effectively impossible.
 */
export function isMcpContentResult(result: unknown): result is McpContentResult {
  if (typeof result !== "object" || result === null) return false;
  const blocks = (result as Record<string, unknown>).mcp_content;
  return Array.isArray(blocks) && blocks.length > 0 && blocks.every(isMcpContentBlock);
}

/**
 * Render a handler result as the `content` array of an MCP tool response.
 *
 * One function rather than one per transport: the standard server and the
 * Cloudflare Durable Object previously each carried their own copy of this
 * two-line rule, and a tool whose response formatting differed between them
 * would be a bug nobody could see from either side.
 */
export function toMcpContent(result: unknown): McpContentBlock[] {
  if (isMcpContentResult(result)) return result.mcp_content;
  return [
    {
      type: "text",
      text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
    },
  ];
}

/**
 * Tool handler function signature
 */
export type ToolHandler = (
  client: FizzyClient,
  args: Record<string, unknown>
) => Promise<HandlerResult>;

/**
 * Helper to convert column color name to CSS variable
 */
function getColumnColorValue(color?: string): string | undefined {
  if (!color) return undefined;
  return COLUMN_COLORS[color as ColumnColor];
}

/**
 * Validate the optional 1-based `page` argument shared by fizzy_get_cards and
 * fizzy_get_notifications.
 *
 * Like the unsupported-filter guard below, this has to run here because the
 * Cloudflare transport executes raw args without zod. Digit strings are accepted
 * because LLM clients routinely send "2"; the stdio path rejects those upstream,
 * and being lenient here costs nothing.
 */
// The Cloudflare transport executes raw args without zod validation, so an
// unknown mode must fail loudly here rather than silently fall back to "any".
function parseSearchMode(value: unknown): "any" | "all" {
  if (value === undefined || value === "any") return "any";
  if (value === "all") return "all";
  throw new Error(
    `Invalid search_mode: ${JSON.stringify(value)}. Expected "any" or "all".`
  );
}

/**
 * Validate the optional `include_attachments` flag of fizzy_get_card and
 * fizzy_get_card_comments.
 *
 * Here rather than only in the Zod schema for the usual reason — the Cloudflare
 * transport dispatches raw args — and with the usual leniency about `"true"`,
 * which LLM clients send routinely for a boolean.
 *
 * Anything else throws rather than defaulting to `false`. Silently ignoring a
 * malformed value would hand back a response with no `attachments` field and no
 * indication why, which reads as "this card has no attachments".
 */
function parseIncludeAttachments(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(
    `include_attachments must be a boolean, got: ${JSON.stringify(value)}`
  );
}

/**
 * The HTML side of a rich-text field, whether it arrives as `{html, plain_text}`
 * (a comment body) or as a bare string (a card's `description_html`).
 *
 * Structural and defensive, like the projections: `description_html` is one of
 * the fields the live API returns and `client/types.ts` does not model.
 */
function richTextHtml(value: unknown): unknown {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    return (value as Record<string, unknown>).html;
  }
  return undefined;
}

function parsePage(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 1) {
    return value;
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    const parsed = parseInt(value, 10);
    if (Number.isSafeInteger(parsed) && parsed >= 1) return parsed;
  }
  throw new Error("page must be a positive integer (1-based), e.g. 2");
}

/**
 * Validate the optional `assignee_ids` argument of the card create/update tools.
 *
 * Like the guards above, this has to run here because the Cloudflare transport
 * executes raw args without zod: a non-array value would otherwise reach the
 * toggle loop and either iterate a string character by character or silently
 * assign nobody.
 *
 * Duplicates are dropped because the upstream endpoint *toggles* assignment —
 * the same id twice would assign and then immediately unassign the same user.
 */
function parseAssigneeIds(value: unknown): string[] | undefined {
  // Only an omitted value means "leave assignments alone". `null` is rejected
  // rather than treated as omission, so this matches what zod does on the
  // validated path instead of quietly ignoring a malformed argument.
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error("assignee_ids must be an array of user ID strings");
  }
  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim() === "") {
      throw new Error("assignee_ids must contain non-empty user ID strings");
    }
  }
  return [...new Set(value as string[])];
}

/**
 * The assignee ids a card payload reports, or `undefined` when it declines to
 * report them all — `_card.json.jbuilder` renders `card.assignees.limit(5)`, so
 * a card over that limit only sets `has_more_assignees` and cannot be compared
 * against a requested set.
 */
function assigneeRoster(card: FizzyCard): string[] | undefined {
  if (card.has_more_assignees) return undefined;
  return (card.assignees ?? []).map((user) => user.id);
}

/**
 * Toggle whatever separates `current` from `desired`, returning the reason each
 * failed id failed.
 *
 * Failures are collected rather than thrown: the card already exists by the time
 * this runs, so aborting on the first bad user id would leave the caller unable
 * to tell what happened to the rest.
 */
async function applyAssignmentDiff(
  client: FizzyClient,
  accountSlug: string,
  cardNumber: string,
  desired: string[],
  current: string[]
): Promise<Map<string, string>> {
  const reasons = new Map<string, string>();
  const toAssign = desired.filter((id) => !current.includes(id));
  const toUnassign = current.filter((id) => !desired.includes(id));

  for (const userId of [...toAssign, ...toUnassign]) {
    try {
      await client.toggleCardAssignment(accountSlug, cardNumber, userId);
    } catch (error) {
      reasons.set(userId, error instanceof Error ? error.message : String(error));
    }
  }
  return reasons;
}

/**
 * Describe the difference between the roster that was asked for and the one the
 * card actually came back with.
 *
 * The toggles are never taken at their word. The endpoint toggles rather than
 * sets, and the HTTP client retries every method on ambiguous transport failures
 * (see the retry loop in `client/fizzy-client.ts`), so a POST that reached Fizzy
 * but whose response was lost gets sent again and lands on the *opposite* state
 * while reporting success. A second caller editing the same card between the
 * read and the writes does the same thing. Neither is preventable from here, so
 * the result is read back and anything that disagrees is reported.
 *
 * `roster` is `undefined` when the end state could not be established, in which
 * case only failures seen directly are reported — an unverifiable result must
 * not be dressed up as a confirmed one.
 */
function describeAssignmentGaps(
  desired: string[],
  roster: string[] | undefined,
  reasons: Map<string, string>,
  options: { replacesRoster: boolean }
): string[] {
  const because = (userId: string) => {
    const reason = reasons.get(userId);
    return reason ? ` (${reason})` : "";
  };

  if (!roster) {
    return [...reasons].map(
      ([userId, reason]) => `Assignment change for user ${userId} failed: ${reason}`
    );
  }

  const warnings = desired
    .filter((userId) => !roster.includes(userId))
    .map((userId) => `User ${userId} was requested but is not assigned${because(userId)}`);

  if (options.replacesRoster) {
    warnings.push(
      ...roster
        .filter((userId) => !desired.includes(userId))
        .map((userId) => `User ${userId} is still assigned${because(userId)}`)
    );
  }
  return warnings;
}

/**
 * The card number of a freshly created card, which every later assignment call
 * is addressed by. Taken from the create response rather than a lookup, since
 * `GET /:slug/cards/:id` itself resolves by number.
 */
function createdCardNumber(card: { number?: number; url?: string }): string | undefined {
  if (card.number !== undefined && card.number !== null) return String(card.number);
  return card.url?.match(/\/cards\/(\d+)/)?.[1];
}

/**
 * All tool handlers indexed by tool name
 */
export const toolHandlers: Record<string, ToolHandler> = {
  // ============ Identity Tools ============
  fizzy_get_identity: async (client) => {
    return client.getIdentity();
  },

  fizzy_get_accounts: async (client) => {
    return client.getAccounts();
  },

  // ============ Board Tools ============
  fizzy_get_boards: async (client, args) => {
    return client.getBoards(args.account_slug as string);
  },

  fizzy_get_board: async (client, args) => {
    return client.getBoard(args.account_slug as string, args.board_id as string);
  },

  fizzy_create_board: async (client, args) => {
    return client.createBoard(args.account_slug as string, {
      name: args.name as string,
    });
  },

  fizzy_update_board: async (client, args) => {
    await client.updateBoard(args.account_slug as string, args.board_id as string, {
      name: args.name as string,
    });
    return `Board ${args.board_id} updated successfully`;
  },

  fizzy_delete_board: async (client, args) => {
    await client.deleteBoard(args.account_slug as string, args.board_id as string);
    return `Board ${args.board_id} deleted successfully`;
  },

  // ============ Card Tools ============
  fizzy_get_cards: async (client, args) => {
    // The Cloudflare transport executes raw args without zod validation, so stale
    // clients sending these removed fields must get a visible error here rather
    // than a silently unfiltered payload. The stdio/Node MCP SDK path strips
    // unknown keys before the handler runs, so this only fires there if a
    // pre-validation bug ever reintroduces one of these fields.
    const unsupported = ["status", "due_before", "due_after"].filter(
      (key) => args[key] !== undefined
    );
    if (unsupported.length > 0) {
      throw new Error(
        `Unsupported filter(s): ${unsupported.join(", ")}. ` +
        `The Fizzy cards API cannot filter by status or due date. ` +
        `Card listings always contain published cards; use indexed_by="closed" for closed cards.`
      );
    }
    const fieldsMode = parseFieldsMode(args.fields);
    const searchMode = parseSearchMode(args.search_mode);
    // Upstream ANDs separate terms[] elements and ORs the words inside one, so
    // "all" sends one element per usable word; "any" keeps the single element.
    let searchTerms: SearchTerms | undefined;
    let terms: string[] | undefined;
    if (searchMode === "all" && typeof args.search === "string") {
      // An empty or all-stopword search must fail visibly here: falling through
      // would list every card, which is the opposite of "every word must match".
      searchTerms = splitSearchTerms(args.search);
      if (searchTerms.terms.length === 0) {
        const reason = searchTerms.ignored.length > 0
          ? `: every word is a full-text stopword or shorter than 3 characters (${searchTerms.ignored.join(", ")})`
          : "";
        throw new Error(
          `search_mode "all" found no searchable word in ${JSON.stringify(args.search)}${reason}. ` +
          `Use a longer or more distinctive word.`
        );
      }
      terms = searchTerms.terms;
    } else if (args.search) {
      terms = [args.search as string];
    }
    const options: CardListOptions = {
      board_ids: args.board_id ? [args.board_id as string] : undefined,
      column_ids: args.column_id ? [args.column_id as string] : undefined,
      terms,
      indexed_by: args.indexed_by as CardListOptions["indexed_by"],
      assignee_ids: args.assignee_ids as string[] | undefined,
      tag_ids: args.tag_ids as string[] | undefined,
      page: parsePage(args.page),
    };
    const result = await client.getCards(args.account_slug as string, options);
    // Only search_mode="all" adds fields; the default response shape is unchanged.
    const searchFields = searchTerms
      ? { search_terms: searchTerms.terms, ignored_search_terms: searchTerms.ignored }
      : {};
    if (fieldsMode === "full") return { ...result, ...searchFields };
    return {
      cards: result.cards.map((card) =>
        summarizeCard(card as unknown as Record<string, unknown>)
      ),
      page: result.page,
      total_count: result.total_count,
      has_more: result.has_more,
      next_page: result.next_page,
      ...searchFields,
    };
  },

  fizzy_get_card: async (client, args) => {
    // Parsed before the request so a malformed flag fails without spending an
    // API round-trip, the same ordering fizzy_get_pins uses for `fields`.
    const includeAttachments = parseIncludeAttachments(args.include_attachments);
    const card = await client.getCard(
      args.account_slug as string,
      args.card_id as string
    );
    // Without the flag this returns the client's value untouched — the response
    // is byte-for-byte what it was before include_attachments existed.
    if (!includeAttachments) return card;

    // Defensive: the declared return type says this is always an object, but a
    // 204 or an empty body reaches here as undefined, and spreading that throws.
    if (typeof card !== "object" || card === null) return card;

    const record = card as unknown as Record<string, unknown>;
    return {
      ...record,
      // `description_html` is one of the fields the live API returns and
      // client/types.ts does not model; parseActionTextAttachments takes
      // `unknown` precisely so this needs no cast to reach it.
      attachments: parseActionTextAttachments(
        richTextHtml(record.description_html),
        client.getBaseUrl()
      ),
    };
  },

  // Assignments are applied *after* the card exists rather than in the create
  // payload: the upstream controller permits only title/description/image/
  // created_at/last_active_at, so an `assignee_ids` key in the card body is
  // dropped by strong params and the card is created unassigned with no error
  // anywhere in the response (issue #9).
  fizzy_create_card: async (client, args) => {
    const accountSlug = args.account_slug as string;
    const assigneeIds = parseAssigneeIds(args.assignee_ids);

    const card = await client.createCard(accountSlug, args.board_id as string, {
      title: args.title as string,
      description: args.description as string,
      status: args.status as "draft" | "published" | undefined,
      column_id: args.column_id as string,
      tag_ids: args.tag_ids as string[],
      due_on: args.due_on as string,
    });

    if (!assigneeIds || assigneeIds.length === 0) return card;

    const cardNumber = createdCardNumber(card);
    if (!cardNumber) {
      return {
        ...card,
        assignment_warnings: [
          "Card created, but its number could not be read from the response, " +
          "so no assignments were applied. Use fizzy_toggle_card_assignment to assign users.",
        ],
      };
    }

    // A new card has no assignments at all, so the whole requested set is the
    // diff — no need to read the roster first.
    const reasons = await applyAssignmentDiff(client, accountSlug, cardNumber, assigneeIds, []);

    // Re-read the card so `assignees` reflects the assignments just made. The
    // create response is rendered before any of them exist, and returning it
    // unchanged is what made the original failure invisible.
    let assigned: FizzyCard;
    try {
      assigned = await client.getCard(accountSlug, cardNumber);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        ...card,
        assignment_warnings: [
          ...describeAssignmentGaps(assigneeIds, undefined, reasons, { replacesRoster: false }),
          `Assignments were applied but the card could not be re-read (${reason}), so ` +
          "the 'assignees' field above is from before they were made and may be wrong.",
        ],
      };
    }

    const roster = assigneeRoster(assigned);
    const warnings = describeAssignmentGaps(assigneeIds, roster, reasons, {
      // Creating a card doesn't claim ownership of anyone else's assignment —
      // a self-assignment landing alongside this call is not a failure.
      replacesRoster: false,
    });
    if (!roster) {
      // Over five assignees the API stops listing them, so a requested user that
      // didn't take can no longer be spotted. Say so rather than let a
      // warning-free response imply the whole set was confirmed.
      warnings.unshift(
        "The card reports more than 5 assignees, so the API no longer lists them all and " +
        "the requested assignments could not be verified."
      );
    }
    return warnings.length > 0 ? { ...assigned, assignment_warnings: warnings } : assigned;
  },

  fizzy_update_card: async (client, args) => {
    const accountSlug = args.account_slug as string;
    const cardId = args.card_id as string;
    const desiredAssignees = parseAssigneeIds(args.assignee_ids);

    // `assignee_ids` is documented as a full replacement, and the only way to
    // honour that against a toggle-based endpoint is to diff it against the
    // current roster. Read that before mutating anything, so a card we cannot
    // safely replace assignments on fails before its title changes.
    let currentAssignees: string[] = [];
    if (desiredAssignees) {
      const existing = await client.getCard(accountSlug, cardId);
      if (existing.has_more_assignees) {
        throw new Error(
          `Card ${cardId} has more than 5 assignees, and the API only reports the first 5. ` +
          "Replacing the assignee list would leave the ones it doesn't report still assigned. " +
          "Use fizzy_toggle_card_assignment to change this card's assignments individually."
        );
      }
      currentAssignees = (existing.assignees ?? []).map((user) => user.id);
    }

    const cardFields = {
      title: args.title as string,
      description: args.description as string,
      status: args.status as "draft" | "published" | "archived" | undefined,
      column_id: args.column_id as string,
      tag_ids: args.tag_ids as string[],
      due_on: args.due_on as string,
    };

    // Only send the card payload when it actually carries something. Upstream's
    // `params.expect(card: [...])` raises ParameterMissing on an empty hash, so
    // an assignments-only update would otherwise serialize to `{"card":{}}` and
    // come back 400 before reaching the assignment calls below.
    if (Object.values(cardFields).some((value) => value !== undefined)) {
      await client.updateCard(accountSlug, cardId, cardFields);
    } else if (!desiredAssignees) {
      throw new Error(
        `No changes given for card ${cardId}. Pass at least one of title, description, ` +
        "status, column_id, tag_ids, due_on or assignee_ids."
      );
    }

    if (!desiredAssignees) return `Card ${cardId} updated successfully`;

    const reasons = await applyAssignmentDiff(
      client,
      accountSlug,
      cardId,
      desiredAssignees,
      currentAssignees
    );

    // Report the roster the card actually ends up with, not the one the toggles
    // were supposed to produce — see describeAssignmentGaps for why they differ.
    // This runs even when the diff was empty: "already correct" is a claim about
    // the pre-flight snapshot, and the roster can have moved since.
    let roster: string[] | undefined;
    let readError: string | undefined;
    try {
      roster = assigneeRoster(await client.getCard(accountSlug, cardId));
    } catch (error) {
      readError = error instanceof Error ? error.message : String(error);
    }

    const warnings = describeAssignmentGaps(desiredAssignees, roster, reasons, {
      replacesRoster: true,
    });
    const summary = roster
      ? `Card ${cardId} updated successfully (assignees: ` +
        `${roster.filter((id) => !currentAssignees.includes(id)).length} added, ` +
        `${currentAssignees.filter((id) => !roster.includes(id)).length} removed)`
      : `Card ${cardId} updated successfully, but the resulting assignee list could not be ` +
        `verified (${readError ?? "the card now reports more than 5 assignees"})`;

    return warnings.length > 0 ? `${summary}. ${warnings.join("; ")}` : summary;
  },

  fizzy_delete_card: async (client, args) => {
    await client.deleteCard(args.account_slug as string, args.card_id as string);
    return `Card ${args.card_id} deleted successfully`;
  },

  // ============ Card Action Tools ============
  fizzy_close_card: async (client, args) => {
    await client.closeCard(args.account_slug as string, args.card_number as string);
    return `Card ${args.card_number} closed`;
  },

  fizzy_reopen_card: async (client, args) => {
    await client.reopenCard(args.account_slug as string, args.card_number as string);
    return `Card ${args.card_number} reopened`;
  },

  fizzy_move_card_to_not_now: async (client, args) => {
    await client.moveCardToNotNow(args.account_slug as string, args.card_number as string);
    return `Card ${args.card_number} moved to Not Now`;
  },

  fizzy_move_card_to_column: async (client, args) => {
    await client.moveCardToColumn(
      args.account_slug as string,
      args.card_number as string,
      args.column_id as string
    );
    return `Card ${args.card_number} moved to column ${args.column_id}`;
  },

  fizzy_send_card_to_triage: async (client, args) => {
    await client.sendCardToTriage(args.account_slug as string, args.card_number as string);
    return `Card ${args.card_number} sent to triage`;
  },

  fizzy_toggle_card_tag: async (client, args) => {
    await client.toggleCardTag(
      args.account_slug as string,
      args.card_number as string,
      args.tag_title as string
    );
    return `Tag "${args.tag_title}" toggled on card ${args.card_number}`;
  },

  fizzy_toggle_card_assignment: async (client, args) => {
    await client.toggleCardAssignment(
      args.account_slug as string,
      args.card_number as string,
      args.assignee_id as string
    );
    return `User ${args.assignee_id} assignment toggled on card ${args.card_number}`;
  },

  fizzy_watch_card: async (client, args) => {
    await client.watchCard(args.account_slug as string, args.card_number as string);
    return `Now watching card ${args.card_number}`;
  },

  fizzy_unwatch_card: async (client, args) => {
    await client.unwatchCard(args.account_slug as string, args.card_number as string);
    return `Stopped watching card ${args.card_number}`;
  },

  fizzy_gild_card: async (client, args) => {
    await client.gildCard(args.account_slug as string, args.card_number as string);
    return `Card ${args.card_number} marked as golden`;
  },

  fizzy_ungild_card: async (client, args) => {
    await client.ungildCard(args.account_slug as string, args.card_number as string);
    return `Card ${args.card_number} golden status removed`;
  },

  // ============ Pin Tools ============
  fizzy_pin_card: async (client, args) => {
    await client.pinCard(args.account_slug as string, args.card_number as string);
    return `Card ${args.card_number} pinned`;
  },

  fizzy_unpin_card: async (client, args) => {
    await client.unpinCard(args.account_slug as string, args.card_number as string);
    return `Card ${args.card_number} unpinned`;
  },

  fizzy_get_pins: async (client, args) => {
    // Parsed before the request so an invalid `fields` value fails fast on the
    // unvalidated Cloudflare path rather than after spending an API round-trip.
    const fieldsMode = parseFieldsMode(args.fields);
    const pins = await client.getPins(args.account_slug as string);
    if (fieldsMode === "full") return pins;
    return pins.map((card) =>
      summarizeCard(card as unknown as Record<string, unknown>)
    );
  },

  // ============ Comment Tools ============
  fizzy_get_card_comments: async (client, args) => {
    // Validated before resolveCardNumber, which makes its own API round-trip: on the
    // unvalidated Cloudflare path a bad `fields` value would otherwise spend a request
    // first, and a failure there would mask the real invalid-argument error.
    const fieldsMode = parseFieldsMode(args.fields);
    const includeAttachments = parseIncludeAttachments(args.include_attachments);
    const cardNumber = await resolveCardNumber(
      client,
      args.account_slug as string,
      args.card_id as string | undefined,
      args.card_number as string | undefined
    );
    const comments = await client.getCardComments(args.account_slug as string, cardNumber);

    // Both modes' existing output is produced first and returned untouched when
    // the flag is absent, so neither response shape moves for existing callers.
    if (!includeAttachments) {
      if (fieldsMode === "full") return comments;
      return comments.map((comment) =>
        summarizeComment(comment as unknown as Record<string, unknown>)
      );
    }

    // Attachments are added in summary mode too, and are most useful there:
    // summarizeComment drops `body.html`, which is the only place they appear.
    const baseUrl = client.getBaseUrl();
    return comments.map((comment) => {
      const record = comment as unknown as Record<string, unknown>;
      const projected = fieldsMode === "full" ? record : summarizeComment(record);
      return {
        ...projected,
        attachments: parseActionTextAttachments(richTextHtml(record.body), baseUrl),
      };
    });
  },

  fizzy_get_comment: async (client, args) => {
    return client.getComment(
      args.account_slug as string,
      args.card_number as string,
      args.comment_id as string
    );
  },

  fizzy_create_comment: async (client, args) => {
    const cardNumber = await resolveCardNumber(
      client,
      args.account_slug as string,
      args.card_id as string | undefined,
      args.card_number as string | undefined
    );
    return client.createCardComment(args.account_slug as string, cardNumber, {
      body: args.body as string,
    });
  },

  fizzy_update_comment: async (client, args) => {
    await client.updateComment(
      args.account_slug as string,
      args.card_number as string,
      args.comment_id as string,
      { body: args.body as string }
    );
    return `Comment ${args.comment_id} updated`;
  },

  fizzy_delete_comment: async (client, args) => {
    await client.deleteComment(
      args.account_slug as string,
      args.card_number as string,
      args.comment_id as string
    );
    return `Comment ${args.comment_id} deleted successfully`;
  },

  // ============ Reaction Tools ============
  fizzy_get_reactions: async (client, args) => {
    return client.getReactions(
      args.account_slug as string,
      args.card_number as string,
      args.comment_id as string
    );
  },

  fizzy_add_reaction: async (client, args) => {
    return client.addReaction(
      args.account_slug as string,
      args.card_number as string,
      args.comment_id as string,
      args.content as string
    );
  },

  fizzy_remove_reaction: async (client, args) => {
    await client.removeReaction(
      args.account_slug as string,
      args.card_number as string,
      args.comment_id as string,
      args.reaction_id as string
    );
    return `Reaction ${args.reaction_id} removed`;
  },

  // ============ Step (To-Do) Tools ============
  fizzy_get_step: async (client, args) => {
    return client.getStep(
      args.account_slug as string,
      args.card_number as string,
      args.step_id as string
    );
  },

  fizzy_create_step: async (client, args) => {
    return client.createStep(args.account_slug as string, args.card_number as string, {
      content: args.content as string,
    });
  },

  fizzy_update_step: async (client, args) => {
    await client.updateStep(
      args.account_slug as string,
      args.card_number as string,
      args.step_id as string,
      {
        content: args.content as string,
        completed: args.completed as boolean,
      }
    );
    return `Step ${args.step_id} updated`;
  },

  fizzy_delete_step: async (client, args) => {
    await client.deleteStep(
      args.account_slug as string,
      args.card_number as string,
      args.step_id as string
    );
    return `Step ${args.step_id} deleted`;
  },

  // ============ Column Tools ============
  fizzy_get_columns: async (client, args) => {
    return client.getColumns(args.account_slug as string, args.board_id as string);
  },

  fizzy_get_column: async (client, args) => {
    return client.getColumn(
      args.account_slug as string,
      args.board_id as string,
      args.column_id as string
    );
  },

  fizzy_create_column: async (client, args) => {
    return client.createColumn(args.account_slug as string, args.board_id as string, {
      name: args.name as string,
      color: getColumnColorValue(args.color as string),
    });
  },

  fizzy_update_column: async (client, args) => {
    await client.updateColumn(
      args.account_slug as string,
      args.board_id as string,
      args.column_id as string,
      {
        name: args.name as string,
        color: getColumnColorValue(args.color as string),
      }
    );
    return `Column ${args.column_id} updated successfully`;
  },

  fizzy_delete_column: async (client, args) => {
    await client.deleteColumn(
      args.account_slug as string,
      args.board_id as string,
      args.column_id as string
    );
    return `Column ${args.column_id} deleted successfully`;
  },

  // ============ Tag Tools ============
  fizzy_get_tags: async (client, args) => {
    return client.getTags(args.account_slug as string);
  },

  // ============ User Tools ============
  fizzy_get_users: async (client, args) => {
    return client.getUsers(args.account_slug as string);
  },

  fizzy_get_user: async (client, args) => {
    return client.getUser(args.account_slug as string, args.user_id as string);
  },

  fizzy_update_user: async (client, args) => {
    await client.updateUser(args.account_slug as string, args.user_id as string, {
      name: args.name as string,
    });
    return `User ${args.user_id} updated successfully`;
  },

  fizzy_deactivate_user: async (client, args) => {
    await client.deactivateUser(args.account_slug as string, args.user_id as string);
    return `User ${args.user_id} deactivated successfully`;
  },

  // ============ Notification Tools ============
  fizzy_get_notifications: async (client, args) => {
    const fieldsMode = parseFieldsMode(args.fields);
    // Omitted means the client is called exactly as before, with no options
    // object at all: that selects the page-less upstream request, the only one
    // that returns unread items.
    const page = parsePage(args.page);
    const notifications =
      page === undefined
        ? await client.getNotifications(args.account_slug as string)
        : await client.getNotifications(args.account_slug as string, { page });
    if (fieldsMode === "full") return notifications;
    return notifications.map((notification) =>
      summarizeNotification(notification as unknown as Record<string, unknown>)
    );
  },

  fizzy_mark_notification_read: async (client, args) => {
    await client.markNotificationAsRead(
      args.account_slug as string,
      args.notification_id as string
    );
    return `Notification ${args.notification_id} marked as read`;
  },

  fizzy_mark_notification_unread: async (client, args) => {
    await client.markNotificationAsUnread(
      args.account_slug as string,
      args.notification_id as string
    );
    return `Notification ${args.notification_id} marked as unread`;
  },

  fizzy_mark_all_notifications_read: async (client, args) => {
    await client.markAllNotificationsAsRead(args.account_slug as string);
    return "All notifications marked as read";
  },

  // ============ Attachment Tools ============
  fizzy_upload_file: async (client, args) => {
    const file = await resolveAttachment(args);
    const upload = await client.uploadFile(args.account_slug as string, file);

    return {
      // attachable_sgid, not signed_id — see FizzyDirectUpload for why they differ.
      attachable_sgid: upload.attachable_sgid,
      filename: upload.filename,
      content_type: upload.content_type,
      byte_size: upload.byte_size,
      attachment_html: attachmentHtml(upload.attachable_sgid),
      next_step:
        "Include attachment_html verbatim in a rich-text field to attach the file — for " +
        "example as the 'body' of fizzy_create_comment, or the 'description' of " +
        "fizzy_update_card. Do not rebuild the tag by hand.",
    };
  },

  // Reads an attachment back so the model can look at it. The security
  // properties this depends on live one layer down, deliberately:
  // parseAttachmentRequest refuses a caller-supplied URL and pins every token to
  // a single path segment, and FizzyClient.fetchAttachment walks the redirect to
  // storage by hand so the Fizzy token never leaves the Fizzy origin.
  fizzy_get_attachment: async (client, args) => {
    const { accountSlug, ...ref } = parseAttachmentRequest(args);

    let fetched;
    try {
      fetched = await client.fetchAttachment(accountSlug, ref, {
        maxBytes: MAX_INLINE_IMAGE_BYTES,
        // A zip or a video has nothing a model can look at, so its bytes are
        // never downloaded — the caller gets the metadata and an explanation
        // instead of megabytes of base64.
        shouldReadBody: isInlineableImage,
      });
    } catch (error) {
      if (error instanceof FizzyAttachmentTooLargeError && ref.variation === undefined) {
        throw new Error(
          `${error.message}. Re-request it with the attachment's 'preview_variation' ` +
            `as 'variation' to fetch the resized preview instead.`
        );
      }
      throw error;
    }

    const contentType = fetched.contentType || "application/octet-stream";
    const summary = {
      filename: ref.filename,
      content_type: contentType,
      byte_size: fetched.byteSize,
      variant: ref.variation ? "preview" : "original",
    };

    if (fetched.bytes === undefined) {
      return {
        ...summary,
        renderable: false,
        note:
          `This attachment is ${contentType}, which cannot be shown as an image, so its ` +
          `bytes were not downloaded. Open the attachment's 'url' in a browser to view it.`,
      };
    }

    return mcpContent([
      { type: "text", text: JSON.stringify(summary, null, 2) },
      {
        type: "image",
        data: bytesToBase64(fetched.bytes),
        mimeType: contentType,
      },
    ]);
  },
};

/**
 * Execute a tool by name
 */
export async function executeToolHandler(
  client: FizzyClient,
  toolName: string,
  args: Record<string, unknown>
): Promise<HandlerResult> {
  const handler = toolHandlers[toolName];
  if (!handler) {
    throw new Error(`Unknown tool: ${toolName}`);
  }
  return handler(client, args);
}
