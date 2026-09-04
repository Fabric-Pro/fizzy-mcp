import { describe, it, expect, vi, afterEach } from "vitest";
import { Logger } from "../../src/utils/logger.js";

function captureStderr(fn: () => void): string[] {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    fn();
    return spy.mock.calls.map(call => String(call[0]));
  } finally {
    spy.mockRestore();
  }
}

describe("Logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes one line per call", () => {
    const log = new Logger("test");
    log.setLevel("debug");

    const lines = captureStderr(() => log.info("hello"));

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("[test] [INFO] hello");
  });

  it("escapes newlines in the message so a caller cannot forge log lines", () => {
    const log = new Logger("test");
    log.setLevel("debug");
    const forged = "rejected\n[2020-01-01T00:00:00.000Z] [test] [INFO] all clear";

    const lines = captureStderr(() => log.warn(forged));

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("\n");
    expect(lines[0]).toContain("rejected\\n[2020-01-01");
  });

  it("escapes carriage returns, which can overwrite a rendered line", () => {
    const log = new Logger("test");

    const lines = captureStderr(() => log.error("bad\r\nspoofed"));

    expect(lines[0]).not.toMatch(/[\r\n]/);
    expect(lines[0]).toContain("bad\\r\\nspoofed");
  });

  it("escapes newlines in the prefix as well as the message", () => {
    const log = new Logger("test\n[forged] [test] [INFO] all clear");

    const lines = captureStderr(() => log.info("real"));

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(/[\r\n]/);
  });

  it("escapes newlines in a child sub-prefix", () => {
    const log = new Logger("test").child("sub\nforged");

    const lines = captureStderr(() => log.info("real"));

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(/[\r\n]/);
  });

  it("keeps structured data on the same line", () => {
    const log = new Logger("test");

    const lines = captureStderr(() => log.info("origin rejected", { origin: "a\nb" }));

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(/[\r\n]/);
    expect(lines[0]).toContain('{"origin":"a\\nb"}');
  });

  it("respects the configured level", () => {
    const log = new Logger("test");
    log.setLevel("warn");

    const lines = captureStderr(() => {
      log.debug("skipped");
      log.info("skipped");
      log.warn("kept");
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("kept");
  });

  it("gives child loggers a sub-prefix and the parent level", () => {
    const parent = new Logger("test");
    parent.setLevel("debug");
    const child = parent.child("security");

    const lines = captureStderr(() => child.debug("checking"));

    expect(lines[0]).toContain("[test:security] [DEBUG] checking");
  });
});
