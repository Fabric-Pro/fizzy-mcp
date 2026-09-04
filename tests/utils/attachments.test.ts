import { describe, it, expect, vi, afterEach } from "vitest";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_INLINE_IMAGE_BYTES,
  attachmentHtml,
  contentTypeForFilename,
  isInlineableImage,
  parseAttachmentRequest,
  resolveAttachment,
} from "../../src/utils/attachments.js";
import { maxEncodedLength } from "../../src/utils/base64.js";
import { setLocalFileReader } from "../../src/utils/file-source.js";

const base64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

afterEach(() => {
  setLocalFileReader(null);
});

describe("attachmentHtml", () => {
  it("emits the ActionText element with the signed id as sgid", () => {
    expect(attachmentHtml("eyJfcmFpbHMi--abc123")).toBe(
      '<action-text-attachment sgid="eyJfcmFpbHMi--abc123"></action-text-attachment>'
    );
  });

  it("escapes the attribute rather than trusting the signed id", () => {
    const html = attachmentHtml('a"><script>alert(1)</script>');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&quot;");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("contentTypeForFilename", () => {
  it.each([
    ["shot.png", "image/png"],
    ["photo.JPG", "image/jpeg"],
    ["photo.jpeg", "image/jpeg"],
    ["report.pdf", "application/pdf"],
    ["notes.md", "text/markdown"],
    ["server.log", "text/plain"],
  ])("maps %s to %s", (filename, expected) => {
    expect(contentTypeForFilename(filename)).toBe(expected);
  });

  it("falls back to a generic type for unknown and absent extensions", () => {
    expect(contentTypeForFilename("archive.xyz")).toBe("application/octet-stream");
    expect(contentTypeForFilename("Makefile")).toBe("application/octet-stream");
  });
});

describe("resolveAttachment", () => {
  describe("base64_data", () => {
    it("decodes the bytes and infers the content type from the filename", async () => {
      const resolved = await resolveAttachment({
        base64_data: base64("hello"),
        filename: "greeting.txt",
      });

      expect(new TextDecoder().decode(resolved.bytes)).toBe("hello");
      expect(resolved.filename).toBe("greeting.txt");
      expect(resolved.contentType).toBe("text/plain");
    });

    it("prefers an explicit content_type over the inferred one", async () => {
      const resolved = await resolveAttachment({
        base64_data: base64("x"),
        filename: "data.txt",
        content_type: "application/json",
      });

      expect(resolved.contentType).toBe("application/json");
    });

    it("strips any directory component from the supplied filename", async () => {
      const resolved = await resolveAttachment({
        base64_data: base64("x"),
        filename: "../../etc/passwd.txt",
      });

      expect(resolved.filename).toBe("passwd.txt");
    });

    it("requires a filename, which cannot be inferred from bytes", async () => {
      await expect(resolveAttachment({ base64_data: base64("x") })).rejects.toThrow(
        /filename is required/
      );
    });

    it("works with no local file reader installed", async () => {
      // The hosted transports never install one; base64 must still work there.
      expect(
        (await resolveAttachment({ base64_data: base64("x"), filename: "a.txt" })).bytes.length
      ).toBe(1);
    });

    // The guard has to bound its own cost, not just the decode: optionalString
    // calls .trim(), which copies the whole string, so an over-cap payload must
    // be refused before that copy — mirroring the replace-spy assertion in
    // base64.test.ts for base64ToBytes's own raw-length guard.
    it("rejects an over-cap base64_data without trimming it first", async () => {
      const oversized = "A".repeat(maxEncodedLength(MAX_ATTACHMENT_BYTES) + 1);
      const trimSpy = vi.spyOn(String.prototype, "trim");

      try {
        await expect(
          resolveAttachment({ base64_data: oversized, filename: "a.txt" })
        ).rejects.toThrow(/upload limit/);
        expect(trimSpy).not.toHaveBeenCalled();
      } finally {
        trimSpy.mockRestore();
      }
    });
  });

  describe("file_path", () => {
    it("reads through the injected reader and infers name and type from the path", async () => {
      setLocalFileReader(async () => new Uint8Array([1, 2, 3]));

      const resolved = await resolveAttachment({ file_path: "C:/shots/bug.png" });

      expect(Array.from(resolved.bytes)).toEqual([1, 2, 3]);
      expect(resolved.filename).toBe("bug.png");
      expect(resolved.contentType).toBe("image/png");
    });

    it("handles POSIX paths", async () => {
      setLocalFileReader(async () => new Uint8Array([1]));
      expect((await resolveAttachment({ file_path: "/tmp/a/b/report.pdf" })).filename).toBe(
        "report.pdf"
      );
    });

    it("strips directory components from an explicit filename too", async () => {
      setLocalFileReader(async () => new Uint8Array([1]));

      const resolved = await resolveAttachment({
        file_path: "C:/shots/bug.png",
        filename: "../../etc/renamed.png",
      });

      expect(resolved.filename).toBe("renamed.png");
    });

    it("passes the path through to the reader unchanged", async () => {
      const seen: string[] = [];
      setLocalFileReader(async (path) => {
        seen.push(path);
        return new Uint8Array([1]);
      });

      await resolveAttachment({ file_path: "C:/shots/bug.png" });

      expect(seen).toEqual(["C:/shots/bug.png"]);
    });

    // The security boundary: without an installed reader — which is every
    // transport except stdio — file_path must be refused, never read.
    it("refuses file_path when no reader is installed", async () => {
      setLocalFileReader(null);

      await expect(resolveAttachment({ file_path: "/etc/passwd" })).rejects.toThrow(
        /only supported on the stdio transport/
      );
    });

    it("names base64_data as the alternative when refusing", async () => {
      await expect(resolveAttachment({ file_path: "/etc/passwd" })).rejects.toThrow(
        /base64_data/
      );
    });
  });

  describe("input validation", () => {
    it("rejects both inputs at once", async () => {
      setLocalFileReader(async () => new Uint8Array([1]));

      await expect(
        resolveAttachment({
          file_path: "a.png",
          base64_data: base64("x"),
          filename: "a.png",
        })
      ).rejects.toThrow(/not both/);
    });

    it("rejects neither input", async () => {
      await expect(resolveAttachment({})).rejects.toThrow(/either file_path .* or base64_data/);
    });

    it("treats blank strings as absent", async () => {
      await expect(
        resolveAttachment({ file_path: "   ", base64_data: "" })
      ).rejects.toThrow(/either file_path .* or base64_data/);
    });

    it("rejects non-string arguments, which the Cloudflare path does not pre-validate", async () => {
      await expect(resolveAttachment({ file_path: 42 })).rejects.toThrow(
        /file_path must be a string/
      );
    });

    it("rejects an empty file rather than uploading nothing", async () => {
      setLocalFileReader(async () => new Uint8Array(0));
      await expect(resolveAttachment({ file_path: "empty.png" })).rejects.toThrow(/is empty/);
    });

    it("rejects a file over the size limit, reporting both sizes", async () => {
      setLocalFileReader(async () => new Uint8Array(MAX_ATTACHMENT_BYTES + 1));

      await expect(resolveAttachment({ file_path: "huge.png" })).rejects.toThrow(
        new RegExp(`${MAX_ATTACHMENT_BYTES + 1} bytes.*${MAX_ATTACHMENT_BYTES}-byte`)
      );
    });

    it("accepts a file exactly at the size limit", async () => {
      setLocalFileReader(async () => new Uint8Array(MAX_ATTACHMENT_BYTES));
      await expect(resolveAttachment({ file_path: "big.png" })).resolves.toBeDefined();
    });
  });
});

describe("isInlineableImage", () => {
  it.each(["image/png", "image/jpeg", "image/gif", "image/webp", "IMAGE/PNG"])(
    "accepts %s",
    (contentType) => {
      expect(isInlineableImage(contentType)).toBe(true);
    }
  );

  it.each([
    // Vector and exotic raster formats: a vision model cannot decode these, so
    // returning an image block for them produces a client error, not a picture.
    "image/svg+xml",
    "image/tiff",
    "image/heic",
    "image/bmp",
    "application/pdf",
    "application/zip",
    "text/plain",
    "",
  ])("declines %s", (contentType) => {
    expect(isInlineableImage(contentType)).toBe(false);
  });
});

describe("MAX_INLINE_IMAGE_BYTES", () => {
  it("is well under the upload cap, because base64 inflates into the response", () => {
    expect(MAX_INLINE_IMAGE_BYTES).toBeLessThan(MAX_ATTACHMENT_BYTES);
    // 4/3 inflation has to stay inside the 5 MB per-image API ceiling.
    expect(Math.ceil((MAX_INLINE_IMAGE_BYTES * 4) / 3)).toBeLessThan(5 * 1024 * 1024);
  });
});

describe("parseAttachmentRequest", () => {
  const SIGNED_ID =
    "eyJfcmFpbHMiOnsiZGF0YSI6ImV4YW1wbGVibG9iaWQiLCJwdXIiOiJibG9iX2lkIn19--1111111111111111111111111111111111111111";

  it("returns the validated parts, with the account slug normalized", () => {
    expect(
      parseAttachmentRequest({
        account_slug: "/1234567",
        signed_id: SIGNED_ID,
        filename: "screenshot.png",
      })
    ).toEqual({
      accountSlug: "1234567",
      signedId: SIGNED_ID,
      filename: "screenshot.png",
    });
  });

  it("carries a variation token through when one is given", () => {
    const variation = "eyJfcmFpbHMiOnt9fQ==--4444444444444444444444444444444444444444";
    expect(
      parseAttachmentRequest({
        account_slug: "1234567",
        signed_id: SIGNED_ID,
        filename: "a.png",
        variation,
      }).variation
    ).toBe(variation);
  });

  it("treats an empty or null variation as absent rather than as a token", () => {
    const base = { account_slug: "1234567", signed_id: SIGNED_ID, filename: "a.png" };
    expect(parseAttachmentRequest({ ...base, variation: "" }).variation).toBeUndefined();
    expect(parseAttachmentRequest({ ...base, variation: null }).variation).toBeUndefined();
  });

  it("rejects a non-string variation", () => {
    expect(() =>
      parseAttachmentRequest({
        account_slug: "1234567",
        signed_id: SIGNED_ID,
        filename: "a.png",
        variation: 7,
      })
    ).toThrow(/variation must be a string/);
  });

  it("rejects a signed id long enough to be a payload rather than a token", () => {
    expect(() =>
      parseAttachmentRequest({
        account_slug: "1234567",
        signed_id: "a".repeat(5000),
        filename: "a.png",
      })
    ).toThrow(/too long/);
  });

  it("rejects a filename longer than a filesystem would accept", () => {
    expect(() =>
      parseAttachmentRequest({
        account_slug: "1234567",
        signed_id: SIGNED_ID,
        filename: `${"a".repeat(300)}.png`,
      })
    ).toThrow(/filename is too long/);
  });

  it("rejects a filename carrying a control character", () => {
    // A NUL truncates a path in anything that hands it to a C API downstream.
    expect(() =>
      parseAttachmentRequest({
        account_slug: "1234567",
        signed_id: SIGNED_ID,
        filename: "a\u0000.png",
      })
    ).toThrow(/control characters/);
  });
});
