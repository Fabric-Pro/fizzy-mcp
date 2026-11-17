/** Node-only implementation; only the stdio entry point installs this capability. */
import { mkdtemp, open, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { LocalFileWriter } from "./utils/file-source.js";
import { FizzyAttachmentTooLargeError } from "./utils/errors.js";

export function parseMaxDownloadBytes(value: string | undefined): number {
  if (value === undefined) return 104857600;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0) {
    throw new Error("FIZZY_MAX_DOWNLOAD_BYTES must be a positive safe integer");
  }
  return Number(value);
}

function diskFilename(filename: string): string {
  let name = filename.replace(/[<>:"|?*]/g, "_").replace(/[. ]+$/g, "");
  if (!name) name = "attachment";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
  return name;
}

export function createLocalFileWriter(maxBytes: number, bodyTimeoutMs = 300000): LocalFileWriter {
  return {
    maxBytes,
    bodyTimeoutMs,
    async write(body, filename, directory) {
      const reader = body.getReader();
      let folder: string | undefined;
      let file: Awaited<ReturnType<typeof open>> | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let copying: Promise<void> | undefined;
      try {
        let target: string;
        if (directory !== undefined) {
          if (typeof directory !== "string" || !isAbsolute(directory)) {
            throw new Error("directory must be an absolute path to an existing directory");
          }
          target = directory;
          let info;
          try { info = await stat(target); } catch {
            throw new Error("directory must exist and be a directory");
          }
          if (!info.isDirectory()) throw new Error("directory must be a directory");
        } else {
          target = tmpdir();
        }
        folder = await mkdtemp(join(target, directory === undefined ? "fizzy-mcp-download-" : "download-"));
        const path = resolve(folder, diskFilename(filename));
        file = await open(path, "wx", 0o600);
        let byteSize = 0;
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`Attachment download body timed out after ${bodyTimeoutMs}ms`));
            void reader.cancel().catch(() => {});
          }, bodyTimeoutMs);
        });
        const copy = async () => {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            byteSize += value.byteLength;
            if (byteSize > maxBytes) {
              throw new FizzyAttachmentTooLargeError(`${filename} is more than ${maxBytes} bytes, over the ${maxBytes}-byte limit for a download`, maxBytes, byteSize);
            }
            // FileHandle.writeFile handles partial writes for this chunk.
            await file!.writeFile(value);
          }
        };
        copying = copy();
        await Promise.race([copying, timeout]);
        await file.close();
        file = undefined;
        return { path, byteSize };
      } catch (error) {
        await reader.cancel().catch(() => {});
        await copying?.catch(() => {});
        await file?.close().catch(() => {});
        if (folder) await rm(folder, { recursive: true, force: true });
        throw error;
      } finally {
        if (timer) clearTimeout(timer);
        reader.releaseLock();
      }
    },
  };
}
