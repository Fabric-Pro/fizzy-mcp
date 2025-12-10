/**
 * Fizzy API Integration Tests - Complete CRUD Coverage
 * 
 * Test Sequence: CREATE → READ → UPDATE → DELETE (clean slate)
 * 
 * API Reference: https://github.com/basecamp/fizzy/blob/main/docs/API.md
 * 
 * SETUP:
 *   FIZZY_ACCESS_TOKEN=your-token npm run test:integration
 * 
 * IMPORTANT:
 *   - NEVER commit the access token to git
 *   - Tests are skipped if FIZZY_ACCESS_TOKEN is not set
 *   - Tests run in sequence to ensure proper cleanup
 * 
 * API REQUEST/RESPONSE FORMATS:
 * 
 *   POST requests:
 *     - Request body wrapped in entity name: { "board": { "name": "..." } }
 *     - Response: 201 Created with Location header (empty body)
 *   
 *   PUT requests:
 *     - Request body wrapped in entity name: { "board": { "name": "..." } }
 *     - Response: 204 No Content
 *   
 *   DELETE requests:
 *     - No request body
 *     - Response: 204 No Content
 */

import { describe, it, expect, beforeAll } from "vitest";
import { FizzyClient } from "../../src/client/fizzy-client.js";

const FIZZY_ACCESS_TOKEN = process.env.FIZZY_ACCESS_TOKEN;
const shouldRun = !!FIZZY_ACCESS_TOKEN;

// Test data - discovered and created during tests
const testData = {
  // Discovered (existing) resources
  accountSlug: "",
  existingBoardId: "",
  existingCardNumber: "",
  existingColumnId: "",
  existingUserId: "",
  
  // Created resources (will be deleted at end)
  createdBoardId: "",
  createdCardNumber: "",
  createdColumnId: "",
  createdCommentId: "",
};

const client = FIZZY_ACCESS_TOKEN
  ? new FizzyClient({
      accessToken: FIZZY_ACCESS_TOKEN,
      baseUrl: "https://app.fizzy.do",
    })
  : null;

describe.skipIf(!shouldRun)("Fizzy API Integration Tests", () => {
  
  // ==========================================
  // PHASE 0: SETUP - Discover existing resources
  // ==========================================
  describe("Phase 0: Setup - Discover Resources", () => {
    beforeAll(() => {
      console.log("\n🔌 Running integration tests against real Fizzy API...");
      console.log("📋 Sequence: SETUP → CREATE → READ → UPDATE → DELETE\n");
    });

    it("GET /my/identity - discovers account", async () => {
      const identity = await client!.getIdentity();

      expect(identity).toBeDefined();
      expect(identity.accounts).toBeDefined();
      expect(identity.accounts.length).toBeGreaterThan(0);

      const account = identity.accounts[0];
      testData.accountSlug = account.slug;
      console.log(`✓ Setup: Using account "${account.name}" (${testData.accountSlug})`);
    });

    it("GET /:account_slug/boards - discovers existing board", async () => {
      const boards = await client!.getBoards(testData.accountSlug);

      expect(boards).toBeDefined();
      expect(boards.length).toBeGreaterThan(0);

      testData.existingBoardId = boards[0].id;
      console.log(`✓ Setup: Found ${boards.length} boards, using "${boards[0].name}"`);
    });

    it("GET /:account_slug/cards - discovers existing cards", async () => {
      const cards = await client!.getCards(testData.accountSlug);

      expect(cards).toBeDefined();

      if (cards.length > 0) {
        const card = cards[0] as { number: number };
        testData.existingCardNumber = card.number.toString();
        console.log(`✓ Setup: Found ${cards.length} cards, using #${testData.existingCardNumber}`);
      } else {
        console.log("✓ Setup: No existing cards found");
      }
    });

    it("GET /:account_slug/boards/:board_id/columns - discovers existing columns", async () => {
      const columns = await client!.getColumns(testData.accountSlug, testData.existingBoardId);

      expect(columns).toBeDefined();

      if (columns.length > 0) {
        testData.existingColumnId = columns[0].id;
        console.log(`✓ Setup: Found ${columns.length} columns`);
      } else {
        console.log("✓ Setup: No existing columns found");
      }
    });

    it("GET /:account_slug/users - discovers existing users", async () => {
      const users = await client!.getUsers(testData.accountSlug);

      expect(users).toBeDefined();
      expect(users.length).toBeGreaterThan(0);

      testData.existingUserId = users[0].id;
      console.log(`✓ Setup: Found ${users.length} users`);
    });
  });

  // ==========================================
  // PHASE 1: CREATE - Create all test resources
  // ==========================================
  describe("Phase 1: CREATE - Create Test Resources", () => {
    beforeAll(() => {
      console.log("\n📝 Phase 1: Creating test resources...\n");
    });

    it("POST /:account_slug/boards - creates board", async () => {
      const boardName = `Integration Test Board ${Date.now()}`;
      
      const result = await client!.createBoard(testData.accountSlug, { name: boardName });
      
      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      
      testData.createdBoardId = result.id;
      console.log(`✓ Created: Board "${boardName}" (${result.id})`);
    });

    it("POST /:account_slug/boards/:board_id/columns - creates column", async () => {
      expect(testData.createdBoardId).toBeTruthy();
      
      const columnName = `Test Column ${Date.now()}`;
      
      const result = await client!.createColumn(testData.accountSlug, testData.createdBoardId, {
        name: columnName,
        color: "lime",
      });
      
      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      
      testData.createdColumnId = result.id;
      console.log(`✓ Created: Column "${columnName}" (${result.id})`);
    });

    it("POST /:account_slug/boards/:board_id/cards - creates card", async () => {
      expect(testData.createdBoardId).toBeTruthy();
      
      const cardTitle = `Integration Test Card ${Date.now()}`;
      
      const result = await client!.createCard(testData.accountSlug, testData.createdBoardId, {
        title: cardTitle,
        status: "published",
      });
      
      expect(result).toBeDefined();
      
      // Extract card number from result
      const cardWithNumber = result as { id: string; number?: number; url?: string };
      if (cardWithNumber.number) {
        testData.createdCardNumber = cardWithNumber.number.toString();
      } else if (cardWithNumber.url) {
        const match = cardWithNumber.url.match(/\/cards\/(\d+)/);
        if (match) testData.createdCardNumber = match[1];
      } else if (cardWithNumber.id) {
        testData.createdCardNumber = cardWithNumber.id;
      }
      
      console.log(`✓ Created: Card "${cardTitle}" (#${testData.createdCardNumber})`);
    });

    it("POST /:account_slug/cards/:card_number/comments - creates comment", async () => {
      expect(testData.createdCardNumber).toBeTruthy();
      
      const commentBody = `Test comment ${Date.now()}`;
      
      const result = await client!.createCardComment(testData.accountSlug, testData.createdCardNumber, {
        body: commentBody,
      });
      
      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      
      testData.createdCommentId = result.id;
      console.log(`✓ Created: Comment (${result.id})`);
    });
  });

  // ==========================================
  // PHASE 2: READ - Read and verify all resources
  // ==========================================
  describe("Phase 2: READ - Verify Resources", () => {
    beforeAll(() => {
      console.log("\n🔍 Phase 2: Reading and verifying resources...\n");
    });

    it("GET /:account_slug/boards/:board_id - reads created board", async () => {
      expect(testData.createdBoardId).toBeTruthy();
      
      const board = await client!.getBoard(testData.accountSlug, testData.createdBoardId);
      
      expect(board).toBeDefined();
      expect(board.id).toBe(testData.createdBoardId);
      console.log(`✓ Read: Board "${board.name}"`);
    });

    it("GET /:account_slug/boards/:board_id/columns/:column_id - reads created column", async () => {
      expect(testData.createdColumnId).toBeTruthy();
      
      const column = await client!.getColumn(
        testData.accountSlug,
        testData.createdBoardId,
        testData.createdColumnId
      );
      
      expect(column).toBeDefined();
      expect(column.id).toBe(testData.createdColumnId);
      console.log(`✓ Read: Column "${column.name}"`);
    });

    it("GET /:account_slug/cards/:card_number - reads created card", async () => {
      expect(testData.createdCardNumber).toBeTruthy();
      
      const card = await client!.getCard(testData.accountSlug, testData.createdCardNumber);
      
      expect(card).toBeDefined();
      expect(card.title).toBeDefined();
      console.log(`✓ Read: Card "${card.title}"`);
    });

    it("GET /:account_slug/cards/:card_number/comments - reads comments", async () => {
      expect(testData.createdCardNumber).toBeTruthy();
      
      const comments = await client!.getCardComments(testData.accountSlug, testData.createdCardNumber);
      
      expect(comments).toBeDefined();
      expect(Array.isArray(comments)).toBe(true);
      expect(comments.length).toBeGreaterThan(0);
      console.log(`✓ Read: Found ${comments.length} comment(s) on card`);
    });

    it("GET /:account_slug/cards/:card_number/comments/:comment_id - reads specific comment", async () => {
      expect(testData.createdCommentId).toBeTruthy();
      
      const comment = await client!.getComment(
        testData.accountSlug,
        testData.createdCardNumber,
        testData.createdCommentId
      );
      
      expect(comment).toBeDefined();
      expect(comment.id).toBeDefined();
      console.log(`✓ Read: Comment verified`);
    });

    it("GET /:account_slug/tags - reads tags", async () => {
      const tags = await client!.getTags(testData.accountSlug);
      
      expect(tags).toBeDefined();
      expect(Array.isArray(tags)).toBe(true);
      console.log(`✓ Read: Found ${tags.length} tags`);
    });

    it("GET /:account_slug/users/:user_id - reads user", async () => {
      expect(testData.existingUserId).toBeTruthy();
      
      const user = await client!.getUser(testData.accountSlug, testData.existingUserId);
      
      expect(user).toBeDefined();
      expect(user.id).toBe(testData.existingUserId);
      console.log(`✓ Read: User "${user.name}"`);
    });

    it("GET /:account_slug/notifications - reads notifications", async () => {
      const notifications = await client!.getNotifications(testData.accountSlug);
      
      expect(notifications).toBeDefined();
      expect(Array.isArray(notifications)).toBe(true);
      console.log(`✓ Read: Found ${notifications.length} notifications`);
    });
  });

  // ==========================================
  // PHASE 3: UPDATE - Update all created resources
  // ==========================================
  describe("Phase 3: UPDATE - Modify Resources", () => {
    beforeAll(() => {
      console.log("\n✏️  Phase 3: Updating resources...\n");
    });

    it("PUT /:account_slug/boards/:board_id - updates board", async () => {
      expect(testData.createdBoardId).toBeTruthy();
      
      const newName = `Updated Board ${Date.now()}`;
      
      await client!.updateBoard(testData.accountSlug, testData.createdBoardId, { name: newName });
      
      // Verify update
      const board = await client!.getBoard(testData.accountSlug, testData.createdBoardId);
      expect(board.name).toBe(newName);
      console.log(`✓ Updated: Board name → "${newName}"`);
    });

    it("PUT /:account_slug/boards/:board_id/columns/:column_id - updates column", async () => {
      expect(testData.createdColumnId).toBeTruthy();
      
      const newName = `Updated Column ${Date.now()}`;
      
      await client!.updateColumn(
        testData.accountSlug,
        testData.createdBoardId,
        testData.createdColumnId,
        { name: newName }
      );
      
      // Verify update
      const column = await client!.getColumn(
        testData.accountSlug,
        testData.createdBoardId,
        testData.createdColumnId
      );
      expect(column.name).toBe(newName);
      console.log(`✓ Updated: Column name → "${newName}"`);
    });

    it("PUT /:account_slug/cards/:card_number - updates card", async () => {
      expect(testData.createdCardNumber).toBeTruthy();
      
      const newTitle = `Updated Card ${Date.now()}`;
      
      await client!.updateCard(testData.accountSlug, testData.createdCardNumber, {
        title: newTitle,
      });
      
      // Verify update
      const card = await client!.getCard(testData.accountSlug, testData.createdCardNumber);
      expect(card.title).toBe(newTitle);
      console.log(`✓ Updated: Card title → "${newTitle}"`);
    });

    it("PUT /:account_slug/cards/:card_number/comments/:comment_id - updates comment", async () => {
      expect(testData.createdCommentId).toBeTruthy();
      
      const newBody = `<p>Updated comment ${Date.now()}</p>`;
      
      await client!.updateComment(
        testData.accountSlug,
        testData.createdCardNumber,
        testData.createdCommentId,
        { body: newBody }
      );
      
      console.log(`✓ Updated: Comment body`);
    });
  });

  // ==========================================
  // PHASE 4: DELETE - Delete all created resources (clean slate)
  // ==========================================
  describe("Phase 4: DELETE - Clean Up (Clean Slate)", () => {
    beforeAll(() => {
      console.log("\n🧹 Phase 4: Deleting test resources (clean slate)...\n");
    });

    it("DELETE /:account_slug/cards/:card_number/comments/:comment_id - deletes comment", async () => {
      if (!testData.createdCommentId) {
        console.log("⚠ Skip: No comment to delete");
        return;
      }
      
      await client!.deleteComment(
        testData.accountSlug,
        testData.createdCardNumber,
        testData.createdCommentId
      );
      
      testData.createdCommentId = "";
      console.log(`✓ Deleted: Comment`);
    });

    it("DELETE /:account_slug/cards/:card_number - deletes card", async () => {
      if (!testData.createdCardNumber) {
        console.log("⚠ Skip: No card to delete");
        return;
      }
      
      await client!.deleteCard(testData.accountSlug, testData.createdCardNumber);
      
      testData.createdCardNumber = "";
      console.log(`✓ Deleted: Card`);
    });

    it("DELETE /:account_slug/boards/:board_id/columns/:column_id - deletes column", async () => {
      if (!testData.createdColumnId) {
        console.log("⚠ Skip: No column to delete");
        return;
      }
      
      await client!.deleteColumn(
        testData.accountSlug,
        testData.createdBoardId,
        testData.createdColumnId
      );
      
      testData.createdColumnId = "";
      console.log(`✓ Deleted: Column`);
    });

    it("DELETE /:account_slug/boards/:board_id - deletes board", async () => {
      if (!testData.createdBoardId) {
        console.log("⚠ Skip: No board to delete");
        return;
      }
      
      await client!.deleteBoard(testData.accountSlug, testData.createdBoardId);
      
      testData.createdBoardId = "";
      console.log(`✓ Deleted: Board`);
    });

    it("Verify clean slate - all test resources removed", () => {
      expect(testData.createdBoardId).toBe("");
      expect(testData.createdCardNumber).toBe("");
      expect(testData.createdColumnId).toBe("");
      expect(testData.createdCommentId).toBe("");
      
      console.log("\n✅ Clean slate: All test resources deleted successfully!\n");
    });
  });
});

// Info test that always runs
describe("Integration Test Info", () => {
  it("displays setup instructions if token not set", () => {
    if (!FIZZY_ACCESS_TOKEN) {
      console.log("\n⚠️  FIZZY_ACCESS_TOKEN not set - integration tests skipped");
      console.log("   To run: FIZZY_ACCESS_TOKEN=your-token npm run test:integration\n");
    }
    expect(true).toBe(true);
  });
});
