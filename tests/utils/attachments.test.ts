import { describe, it, expect, afterEach } from "vitest";
import {
  MAX_ATTACHMENT_BYTES,
  attachmentHtml,
  contentTypeForFilename,
  resolveAttachment,
} from "../../src/utils/attachments.js";
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
