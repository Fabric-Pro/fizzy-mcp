/**
 * The ActionText attachment parser.
 *
 * The fixture below mirrors the shape the live API returns — attribute names
 * and ordering, the nested `<figure>`/`<a>`/`<img>`, and the
 * `representations/redirect/<signed_id>/<variation>/<filename>` preview path —
 * with entirely synthetic ids, filenames and sizes.
 */

import { describe, it, expect } from "vitest";
import { parseActionTextAttachments } from "../../src/utils/action-text.js";

const BASE_URL = "https://fizzy.example.com";
const ACCOUNT = "1234567";

const BLOB_SIGNED_ID =
  "eyJfcmFpbHMiOnsiZGF0YSI6ImV4YW1wbGVibG9iaWQiLCJwdXIiOiJibG9iX2lkIn19--1111111111111111111111111111111111111111";
const ATTACHABLE_SGID =
  "eyJfcmFpbHMiOnsiZGF0YSI6ImV4YW1wbGVzZ2lkIiwicHVyIjoiYXR0YWNoYWJsZSJ9fQ==--2222222222222222222222222222222222222222";
const VARIATION =
  "eyJfcmFpbHMiOnsiZGF0YSI6InJlc2l6ZV90b19saW1pdCIsInB1ciI6InZhcmlhdGlvbiJ9fQ==--3333333333333333333333333333333333333333";

const BLOB_PATH = `/${ACCOUNT}/rails/active_storage/blobs/redirect/${BLOB_SIGNED_ID}/screenshot.png`;
const PREVIEW_PATH = `/${ACCOUNT}/rails/active_storage/representations/redirect/${BLOB_SIGNED_ID}/${VARIATION}/screenshot.png`;

/** One image attachment, shaped as the API actually renders it. */
const IMAGE_ATTACHMENT_HTML =
  `<div class="trix-content">` +
  `<p>Here is the failure:</p>` +
  `<action-text-attachment sgid="${ATTACHABLE_SGID}" content-type="image/png" ` +
  `url="${BLOB_PATH}" filename="screenshot.png" filesize="204800" width="1600" height="900" ` +
  `previewable="true" presentation="gallery">` +
  `<figure class="attachment attachment--preview attachment--png">` +
  `<a href="${BLOB_PATH}">` +
  `<img src="${PREVIEW_PATH}" width="1600" height="900" />` +
  `</a>` +
  `<figcaption class="attachment__caption">screenshot.png</figcaption>` +
  `</figure>` +
  `</action-text-attachment>` +
  `</div>`;

describe("parseActionTextAttachments", () => {
  it("extracts every field from real-shaped markup", () => {
    const [attachment, ...rest] = parseActionTextAttachments(
      IMAGE_ATTACHMENT_HTML,
      BASE_URL
    );

    expect(rest).toHaveLength(0);
    expect(attachment).toEqual({
      filename: "screenshot.png",
      content_type: "image/png",
      byte_size: 204800,
      width: 1600,
      height: 900,
      signed_id: BLOB_SIGNED_ID,
      url: `${BASE_URL}${BLOB_PATH}`,
      preview_url: `${BASE_URL}${PREVIEW_PATH}`,
      preview_variation: VARIATION,
    });
  });

  it("makes the relative paths absolute against the configured base URL", () => {
    // Never app.fizzy.do: a self-hosted or staging deployment has to resolve
    // against itself, which is why the client's baseUrl is threaded through.
    const [attachment] = parseActionTextAttachments(
      IMAGE_ATTACHMENT_HTML,
      "https://fizzy.internal.example:8443"
    );

    expect(attachment.url).toBe(`https://fizzy.internal.example:8443${BLOB_PATH}`);
    expect(attachment.preview_url).toBe(
      `https://fizzy.internal.example:8443${PREVIEW_PATH}`
    );
  });

  it("lifts the signed id out of the url path so it can be fetched directly", () => {
    const [attachment] = parseActionTextAttachments(IMAGE_ATTACHMENT_HTML, BASE_URL);
    expect(attachment.signed_id).toBe(BLOB_SIGNED_ID);
  });

  it("returns nothing for HTML with no attachments", () => {
    expect(
      parseActionTextAttachments(
        "<div><p>Just a description with <b>markup</b> and a <a href='/x'>link</a>.</p></div>",
        BASE_URL
      )
    ).toEqual([]);
  });

  it("returns nothing for absent, empty, or non-string fields", () => {
    expect(parseActionTextAttachments(undefined, BASE_URL)).toEqual([]);
    expect(parseActionTextAttachments(null, BASE_URL)).toEqual([]);
    expect(parseActionTextAttachments("", BASE_URL)).toEqual([]);
    expect(parseActionTextAttachments(42, BASE_URL)).toEqual([]);
    expect(parseActionTextAttachments({ html: IMAGE_ATTACHMENT_HTML }, BASE_URL)).toEqual(
      []
    );
  });

  it("parses several attachments without letting one bleed into the next", () => {
    const second = BLOB_PATH.replace("screenshot.png", "diagram.png");
    const html =
      IMAGE_ATTACHMENT_HTML +
      `<action-text-attachment content-type="image/png" url="${second}" ` +
      `filename="diagram.png" filesize="1024">` +
      `<figure><img src="${second}" /></figure>` +
      `</action-text-attachment>`;

    const parsed = parseActionTextAttachments(html, BASE_URL);

    expect(parsed).toHaveLength(2);
    expect(parsed[0].filename).toBe("screenshot.png");
    expect(parsed[0].preview_url).toBe(`${BASE_URL}${PREVIEW_PATH}`);
    // The second has no representation of its own and must not inherit the
    // first's — that is what bounding the inner markup buys.
    expect(parsed[1].filename).toBe("diagram.png");
    expect(parsed[1].preview_url).toBeUndefined();
    expect(parsed[1].preview_variation).toBeUndefined();
  });

  describe("malformed markup", () => {
    it("reports the attributes that are present and omits the rest", () => {
      const [attachment] = parseActionTextAttachments(
        `<action-text-attachment filename="notes.txt"></action-text-attachment>`,
        BASE_URL
      );

      expect(attachment).toEqual({ filename: "notes.txt" });
    });

    it("treats a non-numeric size or dimension as missing rather than NaN", () => {
      const [attachment] = parseActionTextAttachments(
        `<action-text-attachment filename="a.png" filesize="unknown" width="" height="-5">` +
          `</action-text-attachment>`,
        BASE_URL
      );

      expect(attachment.byte_size).toBeUndefined();
      expect(attachment.width).toBeUndefined();
      expect(attachment.height).toBeUndefined();
    });

    it("does not throw on an unterminated tag", () => {
      expect(() =>
        parseActionTextAttachments(
          `<p>x</p><action-text-attachment filename="a.png" url="${BLOB_PATH}"`,
          BASE_URL
        )
      ).not.toThrow();
      expect(
        parseActionTextAttachments(
          `<p>x</p><action-text-attachment filename="a.png" url="${BLOB_PATH}"`,
          BASE_URL
        )
      ).toEqual([]);
    });

    it("does not cut the tag short at a > inside a quoted attribute", () => {
      const [attachment] = parseActionTextAttachments(
        `<action-text-attachment caption="before &gt; after > still caption" ` +
          `filename="a.png" content-type="image/png"></action-text-attachment>`,
        BASE_URL
      );

      expect(attachment.filename).toBe("a.png");
      expect(attachment.content_type).toBe("image/png");
    });

    it("decodes entity references in attribute values", () => {
      const [attachment] = parseActionTextAttachments(
        `<action-text-attachment filename="a &amp; b.png" ` +
          `url="/1234567/rails/active_storage/blobs/redirect/${BLOB_SIGNED_ID}/a%20b.png?x=1&amp;y=2">` +
          `</action-text-attachment>`,
        BASE_URL
      );

      expect(attachment.filename).toBe("a & b.png");
      expect(attachment.url).toContain("?x=1&y=2");
    });

    it("drops a url whose scheme is not http or https", () => {
      const [attachment] = parseActionTextAttachments(
        `<action-text-attachment filename="a.png" url="javascript:alert(1)">` +
          `</action-text-attachment>`,
        BASE_URL
      );

      expect(attachment.url).toBeUndefined();
      expect(attachment.filename).toBe("a.png");
    });

    it("survives a base URL it cannot parse", () => {
      const parsed = parseActionTextAttachments(IMAGE_ATTACHMENT_HTML, "not a url");

      expect(parsed).toHaveLength(1);
      expect(parsed[0].url).toBeUndefined();
      // The signed id comes out of the path, so it survives a broken base URL —
      // which is the field fizzy_get_attachment actually needs.
      expect(parsed[0].signed_id).toBe(BLOB_SIGNED_ID);
    });

    it("keeps a remote image that has no signed id at all", () => {
      const [attachment] = parseActionTextAttachments(
        `<action-text-attachment content-type="image/jpeg" ` +
          `url="https://images.example.com/remote.jpg" filename="remote.jpg">` +
          `</action-text-attachment>`,
        BASE_URL
      );

      expect(attachment.url).toBe("https://images.example.com/remote.jpg");
      expect(attachment.signed_id).toBeUndefined();
    });

    it("ignores an element that carries nothing usable", () => {
      expect(
        parseActionTextAttachments(
          `<action-text-attachment></action-text-attachment>`,
          BASE_URL
        )
      ).toEqual([]);
    });

    it("does not match a differently named element that shares the prefix", () => {
      expect(
        parseActionTextAttachments(
          `<action-text-attachment-group filename="a.png"></action-text-attachment-group>`,
          BASE_URL
        )
      ).toEqual([]);
    });
  });

  it("reads the blob path out of an href when there is no url attribute", () => {
    const [attachment] = parseActionTextAttachments(
      `<action-text-attachment content-type="application/zip" href="${BLOB_PATH.replace(
        "screenshot.png",
        "logs.zip"
      )}" filename="logs.zip" filesize="90210"></action-text-attachment>`,
      BASE_URL
    );

    expect(attachment.signed_id).toBe(BLOB_SIGNED_ID);
    expect(attachment.byte_size).toBe(90210);
    expect(attachment.content_type).toBe("application/zip");
  });

  it("matches the element name case-insensitively", () => {
    const [attachment] = parseActionTextAttachments(
      `<ACTION-TEXT-ATTACHMENT FILENAME="a.png" CONTENT-TYPE="image/png">` +
        `</ACTION-TEXT-ATTACHMENT>`,
      BASE_URL
    );

    expect(attachment).toEqual({ filename: "a.png", content_type: "image/png" });
  });

  it("stops scanning long before an implausible number of elements", () => {
    const one = `<action-text-attachment filename="a.png"></action-text-attachment>`;
    const parsed = parseActionTextAttachments(one.repeat(500), BASE_URL);

    expect(parsed.length).toBeLessThanOrEqual(200);
    expect(parsed.length).toBeGreaterThan(0);
  });
});
