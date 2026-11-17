import { mkdtemp, readFile, readdir, rm, writeFile, symlink, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, isAbsolute, dirname } from "node:path";
import { FizzyClient } from "../../src/client/fizzy-client.js";
import { toolHandlers } from "../../src/tools/handlers.js";
import { createLocalFileWriter, parseMaxDownloadBytes } from "../../src/local-file-writer.js";
import { setLocalFileWriter } from "../../src/utils/file-source.js";
import { parseAttachmentRequest } from "../../src/utils/attachments.js";

const args = { account_slug: "123456", signed_id: "synthetic--111111", filename: "sample.mp4" };
const baseUrl = "https://api.example.test";
let directory: string;
let client: FizzyClient;
const download = (extra = {}) => toolHandlers.fizzy_download_attachment(client, { ...args, directory, ...extra });
const bytes = new Uint8Array([1, 2, 3, 4]);
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "download-test-"));
  client = new FizzyClient({ accessToken: "synthetic-token", baseUrl });
  setLocalFileWriter(createLocalFileWriter(8));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes, { headers: { "Content-Type": "video/mp4" } })));
});
afterEach(async () => {
  setLocalFileWriter(null);
  vi.unstubAllGlobals();
  await rm(directory, { recursive: true, force: true });
});
it("streams any type and returns metadata for a preview; repeated names stay separate", async () => {
  await writeFile(join(directory, args.filename), "existing");
  const a = await download({ variation: "synthetic-preview--222222" }) as any;
  const b = await download() as any;
  expect(a).toMatchObject({ filename: args.filename, content_type: "video/mp4", byte_size: 4, variant: "preview" });
  expect(isAbsolute(a.path)).toBe(true);
  expect(new Uint8Array(await readFile(a.path))).toEqual(bytes);
  expect(a.path).not.toBe(b.path);
  expect(await readFile(join(directory, args.filename), "utf8")).toBe("existing");
});
it("attaches credentials only on configured origin", async () => {
  const fetchMock = vi.mocked(fetch);
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: "https://storage.example.test/blob" } }));
  await download();
  expect((fetchMock.mock.calls[0][1]?.headers as any).Authorization).toBe("Bearer synthetic-token");
  expect((fetchMock.mock.calls[1][1]?.headers as any).Authorization).toBeUndefined();
});
it("refuses missing writer before fetching", async () => {
  setLocalFileWriter(null);
  await expect(download()).rejects.toThrow(/only supported on the stdio transport.*server's disk is not the caller's/);
  expect(fetch).not.toHaveBeenCalled();
});
it.each(["url", "preview_url", "blob_url", "attachment_url", "src"])("rejects URL-shaped %s with the correct tool name", async key => {
  await expect(download({ [key]: "https://example.test/blob" })).rejects.toThrow("fizzy_download_attachment does not take a URL");
  expect(() => parseAttachmentRequest({ ...args, [key]: "https://example.test/blob" })).toThrow("fizzy_get_attachment does not take a URL");
  expect(fetch).not.toHaveBeenCalled();
});
it("rejects declared excess before starting a writer", async () => {
  const writer = createLocalFileWriter(8);
  const write = vi.spyOn(writer, "write");
  setLocalFileWriter(writer);
  vi.mocked(fetch).mockResolvedValue(new Response(bytes, { headers: { "Content-Length": "9" } }));
  await expect(download()).rejects.toThrow(/sample\.mp4 is 9 bytes, over the 8-byte limit for a download.*preview_variation/);
  expect(write).not.toHaveBeenCalled();
  expect(await readdir(directory)).toEqual([]);
});
it.each([undefined, "1"])("rejects streamed excess with length %s and cleans up", async length => {
  vi.mocked(fetch).mockResolvedValue(new Response(new Uint8Array(9), { headers: length ? { "Content-Length": length } : {} }));
  await expect(download()).rejects.toThrow(/sample\.mp4 is more than 8 bytes, over the 8-byte limit for a download/);
  expect(await readdir(directory)).toEqual([]);
});
it("cleans up after a body stream error", async () => {
  let count = 0;
  vi.mocked(fetch).mockResolvedValue(new Response(new ReadableStream({ pull(controller) {
    if (count++ === 0) controller.enqueue(bytes);
    else controller.error(new Error("synthetic body failure"));
  } })));
  await expect(download()).rejects.toThrow("synthetic body failure");
  expect(await readdir(directory)).toEqual([]);
});
it("handles a network error without output", async () => {
  vi.mocked(fetch).mockRejectedValue(new TypeError("fetch failed"));
  await expect(download()).rejects.toThrow(/Network error/);
  expect(await readdir(directory)).toEqual([]);
});
it("times out a stalled body and removes output", async () => {
  setLocalFileWriter(createLocalFileWriter(8, 20));
  vi.mocked(fetch).mockResolvedValue(new Response(new ReadableStream({})));
  await expect(download()).rejects.toThrow(/timed out/);
  expect(await readdir(directory)).toEqual([]);
});
it.each(["relative", "missing", "file"])("rejects invalid directory: %s", async kind => {
  const file = join(directory, "file");
  await writeFile(file, "existing");
  const target = kind === "relative" ? "." : kind === "missing" ? join(directory, "missing") : file;
  await expect(download({ directory: target })).rejects.toThrow(/directory.*(absolute|exist|directory)/);
  expect(await readdir(directory)).toEqual(["file"]);
});
it.each([["a<>:\"|?*.mp4", "a_______.mp4"], ["CON.mp4", "_CON.mp4"], ["sample. ", "sample"]])("sanitizes %s on disk", async (filename, expected) => {
  const result = await download({ filename }) as any;
  expect(result.path.endsWith(expected)).toBe(true);
  expect(result.filename).toBe(filename.trim());
});
it.each(["", "0", "-1", "1.1", "Infinity", "9007199254740992", "1e3"])("rejects invalid cap %s", value => {
  expect(() => parseMaxDownloadBytes(value)).toThrow("FIZZY_MAX_DOWNLOAD_BYTES");
});
it("parses cap and default", () => {
  expect(parseMaxDownloadBytes(undefined)).toBe(104857600);
  expect(parseMaxDownloadBytes("12")).toBe(12);
});
it("get_attachment note advertises local downloads", async () => {
  const result = await toolHandlers.fizzy_get_attachment(client, args) as any;
  expect(result.note).toContain("fizzy_download_attachment");
});

it("allows a body to outlive the header timeout", async () => {
  client = new FizzyClient({ accessToken: "synthetic-token", baseUrl, timeout: 10 });
  setLocalFileWriter(createLocalFileWriter(8, 500));
  vi.mocked(fetch).mockImplementation(async (_url, init) => {
    return new Response(new ReadableStream({
      start(controller) {
        const timer = setTimeout(() => { controller.enqueue(bytes); controller.close(); }, 35);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          controller.error(new Error("header timer reached the body"));
        });
      },
    }));
  });
  expect((await download() as any).byte_size).toBe(4);
});
it("accepts an exact cap", async () => {
  setLocalFileWriter(createLocalFileWriter(4));
  vi.mocked(fetch).mockResolvedValue(new Response(bytes, { headers: { "Content-Length": "4" } }));
  expect((await download() as any).byte_size).toBe(4);
});
it("cleans up if creating the output file fails", async () => {
  // Below the character limit but above common filesystem byte limits.
  await expect(download({ filename: "é".repeat(200) })).rejects.toThrow();
  expect(await readdir(directory)).toEqual([]);
});
it("rejects a non-string directory on raw dispatch", async () => {
  await expect(download({ directory: 123 })).rejects.toThrow("directory must be an absolute path");
  expect(await readdir(directory)).toEqual([]);
});

it("uses a fresh private directory directly under tmpdir despite a planted legacy path", async () => {
  const previous = process.env.TMPDIR;
  process.env.TMPDIR = directory;
  try {
    const planted = join(directory, "fizzy-mcp-downloads");
    const destination = join(directory, "planted-target");
    await import("node:fs/promises").then(fs => fs.mkdir(destination));
    await symlink(destination, planted, "dir");
    const result = await download({ directory: undefined }) as any;
    expect(dirname(dirname(result.path))).toBe(directory);
    expect(await readdir(destination)).toEqual([]);
    if (process.platform !== "win32") expect((await stat(dirname(result.path))).mode & 0o777).toBe(0o700);
  } finally {
    if (previous === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previous;
  }
});
it("writes an empty file for a successful null body", async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));
  const result = await download() as any;
  expect(result.byte_size).toBe(0);
  expect((await stat(result.path)).size).toBe(0);
});
