import { getInlineContentLimits, setInlineContentLimits, parseInlineLimit } from "../../src/utils/inline-content.js";
import { getAttachmentSchema, downloadAttachmentSchema } from "../../src/tools/schemas.js";
afterEach(() => setInlineContentLimits());
it("advertises opt in only for get", () => {
  expect(getAttachmentSchema.shape).toHaveProperty("include_content");
  expect(downloadAttachmentSchema.shape).not.toHaveProperty("include_content");
});
it.each(["FIZZY_MAX_INLINE_TEXT_BYTES", "FIZZY_MAX_INLINE_BINARY_BYTES"])("validates %s", name => {
  expect(parseInlineLimit(undefined, name, 123)).toBe(123);
  expect(parseInlineLimit("123", name, 1)).toBe(123);
  for (const value of ["0", "-1", "1.5", "10485761", "NaN", "Infinity"]) {
    expect(() => parseInlineLimit(value, name, 1)).toThrow(name);
    setInlineContentLimits(...(name.includes("TEXT") ? [value, undefined] : [undefined, value]));
    expect(() => getInlineContentLimits()).toThrow(name);
  }
});
it.each(["1e3", "0x10", "0b11", "1.0", " 12 ", ""])("rejects non-decimal spelling %j", value => {
  for (const name of ["FIZZY_MAX_INLINE_TEXT_BYTES", "FIZZY_MAX_INLINE_BINARY_BYTES"]) {
    expect(() => parseInlineLimit(value, name, 1)).toThrow(name);
  }
});
it("uses reported non-generic types ahead of extensions", async () => {
  const { classifyInlineContent } = await import("../../src/utils/inline-content.js");
  expect(classifyInlineContent("application/pdf", "report.log")).toEqual({ kind: "binary", mimeType: "application/pdf" });
  expect(classifyInlineContent("image/png", "report.log")).toEqual({ kind: "image", mimeType: "image/png" });
  expect(classifyInlineContent("APPLICATION/OCTET-STREAM; charset=binary", "report.LOG")).toEqual({ kind: "text", mimeType: "text/plain" });
  expect(classifyInlineContent("application/octet-stream", "example.constructor")).toEqual({ kind: "binary", mimeType: "application/octet-stream" });
});
