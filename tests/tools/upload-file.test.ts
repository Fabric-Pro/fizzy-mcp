/**
 * Tool-layer wiring for fizzy_upload_file, including the contract the model
 * depends on: the returned `attachment_html` is what gets pasted into a
 * rich-text field, so it has to reference the signed id the upload produced.
 */

import { describe, it, expect, afterEach } from "vitest";
import { executeToolHandler } from "../../src/tools/handlers.js";
import { getToolDefinition } from "../../src/tools/definitions.js";
import { toolInputJsonSchema } from "../../src/tools/json-schema.js";
import { uploadFileSchema } from "../../src/tools/schemas.js";
import { setLocalFileReader } from "../../src/utils/file-source.js";
import type { FizzyClient } from "../../src/client/fizzy-client.js";

// The two tokens the API returns for one blob. Only the attachable one renders.
const ATTACHABLE_SGID = "eyJfcmFpbHMiOnsiZGF0YSI6ImdpZDovL2Zpenp5In19--attachable-sig";
const BLOB_SIGNED_ID = "eyJfcmFpbHMiOnsiZGF0YSI6IjAzZ2wifX0=--blob-id-sig";

const base64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

function clientStub(record?: (slug: string, file: unknown) => void): FizzyClient {
  return {
    uploadFile: async (slug: string, file: unknown) => {
      record?.(slug, file);
      return {
        id: "abc",
        key: "abc123",
        filename: "screenshot.png",
        content_type: "image/png",
        byte_size: 5,
        checksum: "kAFQmDzST7DWlj99KOF/cg==",
        attachable_sgid: ATTACHABLE_SGID,
        signed_id: BLOB_SIGNED_ID,
        direct_upload: { url: "https://storage.example.com/x", headers: {} },
      };
    },
  } as unknown as FizzyClient;
}

afterEach(() => {
  setLocalFileReader(null);
});

describe("fizzy_upload_file definition", () => {
  it("is registered and declares itself as a non-destructive write", () => {
    const definition = getToolDefinition("fizzy_upload_file");

    expect(definition).toBeDefined();
    expect(definition?.annotations.readOnlyHint).toBe(false);
    expect(definition?.annotations.destructiveHint).toBe(false);
  });

  it("tells the model that the returned HTML is what attaches the file", () => {
    const description = getToolDefinition("fizzy_upload_file")?.description ?? "";

    expect(description).toContain("attachment_html");
    expect(description).toContain("fizzy_create_comment");
  });

  it("publishes a valid JSON Schema with all four inputs", () => {
    const schema = toolInputJsonSchema(uploadFileSchema) as {
      properties?: Record<string, unknown>;
    };
    const published = JSON.stringify(schema);

    for (const field of ["account_slug", "file_path", "base64_data", "filename", "content_type"]) {
      expect(published).toContain(field);
    }
  });
});

describe("fizzy_upload_file schema", () => {
  it("accepts base64_data with a filename", () => {
    expect(
      uploadFileSchema.safeParse({
        account_slug: "123456",
        base64_data: base64("x"),
        filename: "a.txt",
      }).success
    ).toBe(true);
  });

  it("still requires account_slug", () => {
    expect(uploadFileSchema.safeParse({ base64_data: base64("x"), filename: "a.txt" }).success).toBe(
      false
    );
  });

  // The either/or rules are intentionally NOT Zod refinements: a refined schema is
  // a ZodEffects with no shape for McpServer.registerTool to read, so refining
  // would publish an empty property list to stdio clients. resolveAttachment owns
  // these rules instead — which it must anyway, since the Cloudflare transport
  // never runs Zod. See the handler tests below and tests/utils/attachments.test.ts.
  it("publishes a non-empty shape, which a refined schema would not", () => {
    expect(Object.keys(uploadFileSchema.shape)).toEqual([
      "account_slug",
      "file_path",
      "base64_data",
      "filename",
      "content_type",
    ]);
  });
});

describe("fizzy_upload_file handler", () => {
  it("builds the HTML from attachable_sgid, not signed_id", async () => {
    const result = (await executeToolHandler(clientStub(), "fizzy_upload_file", {
      account_slug: "123456",
      base64_data: base64("hello"),
      filename: "screenshot.png",
    })) as Record<string, unknown>;

    expect(result.attachment_html).toBe(
      `<action-text-attachment sgid="${ATTACHABLE_SGID}"></action-text-attachment>`
    );
    // Regression guard for the trap this cost a live round to find: signed_id is
    // also a valid-looking token for the same blob, is what Fizzy's own docs point
    // at, and renders as an unresolved-attachment placeholder.
    expect(result.attachment_html).not.toContain(BLOB_SIGNED_ID);
    expect(result.attachable_sgid).toBe(ATTACHABLE_SGID);
    expect(result.byte_size).toBe(5);
    expect(String(result.next_step)).toContain("fizzy_create_comment");
  });

  it("enforces the either/or rules that are not in the Zod schema", async () => {
    const client = clientStub();

    await expect(
      executeToolHandler(client, "fizzy_upload_file", {
        account_slug: "123456",
        base64_data: base64("x"),
      })
    ).rejects.toThrow(/filename is required/);

    await expect(
      executeToolHandler(client, "fizzy_upload_file", {
        account_slug: "123456",
        file_path: "a.png",
        base64_data: base64("x"),
        filename: "a.png",
      })
    ).rejects.toThrow(/not both/);

    await expect(
      executeToolHandler(client, "fizzy_upload_file", { account_slug: "123456" })
    ).rejects.toThrow(/either file_path .* or base64_data/);
  });

  it("passes the decoded bytes and resolved metadata to the client", async () => {
    let seen: { slug: string; file: any } | undefined;
    await executeToolHandler(clientStub((slug, file) => (seen = { slug, file: file as any })), "fizzy_upload_file", {
      account_slug: "/123456",
      base64_data: base64("hello"),
      filename: "screenshot.png",
    });

    expect(seen?.slug).toBe("/123456");
    expect(new TextDecoder().decode(seen?.file.bytes)).toBe("hello");
    expect(seen?.file.filename).toBe("screenshot.png");
    expect(seen?.file.contentType).toBe("image/png");
  });

  it("refuses file_path on transports with no reader installed, without calling the client", async () => {
    let uploadCalled = false;
    const client = clientStub(() => {
      uploadCalled = true;
    });

    await expect(
      executeToolHandler(client, "fizzy_upload_file", {
        account_slug: "123456",
        file_path: "/etc/passwd",
      })
    ).rejects.toThrow(/only supported on the stdio transport/);

    expect(uploadCalled).toBe(false);
  });

  it("accepts file_path once a reader is installed, as stdio does", async () => {
    setLocalFileReader(async () => new Uint8Array([1, 2, 3, 4, 5]));

    const result = (await executeToolHandler(clientStub(), "fizzy_upload_file", {
      account_slug: "123456",
      file_path: "C:/shots/screenshot.png",
    })) as Record<string, unknown>;

    expect(result.attachable_sgid).toBe(ATTACHABLE_SGID);
  });
});
