/**
 * The single seam through which a local filesystem may enter the tool layer.
 *
 * `fizzy_upload_file` accepts a `file_path` because attaching a local screenshot
 * is the common case and base64-inlining one costs the caller ~1.37x the file
 * size in tokens. But reading local files is only safe where the caller and the
 * server process belong to the same person, which is true of stdio and of
 * nothing else this server ships:
 *
 * - **stdio** — the client is the local user, who can already read their own
 *   disk. Honouring `file_path` grants no capability they lack.
 * - **http / sse** — the client is remote. Reading server-side paths on its
 *   behalf would let it exfiltrate the host's files into Fizzy.
 * - **Cloudflare Workers** — there is no filesystem at all.
 *
 * So the capability is injected rather than imported: the stdio entry point
 * installs a reader, every other transport leaves it unset, and the handler
 * refuses `file_path` when none is installed. A missing reader is the safe
 * default, which means a new transport is closed until it deliberately opts in.
 */

export type LocalFileReader = (path: string) => Promise<Uint8Array>;

let localFileReader: LocalFileReader | null = null;

/** Install (or with `null`, remove) the reader. Called once, at startup. */
export function setLocalFileReader(reader: LocalFileReader | null): void {
  localFileReader = reader;
}

/** The installed reader, or `null` where local file access is not permitted. */
export function getLocalFileReader(): LocalFileReader | null {
  return localFileReader;
}
