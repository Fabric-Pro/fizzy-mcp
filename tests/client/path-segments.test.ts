/**
 * A structural sweep of `src/client/fizzy-client.ts`: every request-path
 * template literal must interpolate only values this file can prove are safe
 * to drop into a URL path segment unguarded.
 *
 * This is what stops a method added later from silently skipping the guard —
 * without it, a new `getWidget(accountSlug, widgetId)` that forgets
 * `assertPathSegment` would compile, pass every other test, and reopen the
 * exact traversal this file exists to close. Follows the precedent of
 * `tests/tools/declared-dependencies.test.ts`: TypeScript 7 is the Go port and
 * ships no JavaScript compiler API, so this reads text rather than an AST.
 *
 * **Design is default-deny, and picks a direction to be wrong in.** For every
 * template that looks like a request path (a backtick string starting with
 * `` /${ ``), every one of its `${...}` interpolations must be provably either:
 *
 *   (a) a name bound earlier in the *same* method by
 *       `const NAME = assertPathSegment(...)`, `this.normalizeSlug(...)` or
 *       `normalizeAccountSlug(...)` — or the method's own parameter named
 *       exactly `slug` (see "the `slug` parameter" below) — or
 *   (b) one of the small, explicitly listed exemptions: `ref.signedId`,
 *       `ref.variation`, `filename`, `queryString`, `requestedPage` — each
 *       justified at its call site in fizzy-client.ts.
 *
 * Anything else — an expression this scanner does not recognise, or a
 * template it cannot attribute to any method — fails the test. It is never
 * silently skipped. Borrowed directly from declared-dependencies.test.ts: a
 * guard that quietly misses a case stops guarding and nobody finds out; a
 * guard that flags one case too many fails loudly and is fixed in a minute.
 * This scanner is built to make the second mistake, never the first.
 *
 * **The `slug` parameter.** `attachmentPath` takes an already-normalized slug
 * as a parameter literally named `slug` (never `accountSlug`) rather than
 * normalizing it itself — its one call site, `fetchAttachment`, computes it
 * via `this.normalizeSlug` first. This file's convention is to spell an
 * already-normalized value `slug` and a raw one `accountSlug`; grepping the
 * file for `slug:` as a parameter type turns up exactly these two spots
 * (`normalizeSlug` itself, which does the normalizing, and `attachmentPath`).
 * So a method's own parameter named exactly `slug` is recognised as safe
 * without requiring a fresh local assignment — this is a narrow, named
 * exception to rule (a), not a blanket one: a parameter named anything else,
 * `accountSlug` included, still needs a real local binding.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const clientPath = join(repoRoot, "src", "client", "fizzy-client.ts");

/** Names that need no local guard — each justified where it appears in fizzy-client.ts. */
const EXEMPT_NAMES = new Set([
  "ref.signedId",
  "ref.variation",
  "filename",
  "queryString",
  "requestedPage",
]);

/** A `${...}` interpolation lifted out of a path template, still in raw text form. */
interface Interpolation {
  expr: string;
}

/** A path-shaped template literal and where it sits in the (comment-blanked) source. */
interface PathTemplate {
  index: number;
  line: number;
  raw: string;
  interpolations: Interpolation[];
}

interface MethodStart {
  name: string;
  index: number;
}

/**
 * Blank `//` and `/* *‍/` comments to spaces (newlines kept, so line numbers
 * stay meaningful), leaving every string and template literal untouched.
 *
 * Reused verbatim from the reasoning in declared-dependencies.test.ts's own
 * `maskSource`: comments have to go before anything structural is counted, or
 * a JSDoc `{@link Foo}` reads as a brace and a doc comment mentioning a URL
 * reads as the start of a real one. Strings and templates are copied through
 * rather than masked, because the next pass needs to read what is actually
 * inside them.
 */
function blankComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }

    if (ch === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        out += source[i] === "\n" ? "\n" : " ";
        i++;
      }
      out += "  ";
      i += 2;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      out += ch;
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\") {
          out += source[i] + (source[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += source[i];
        i++;
      }
      out += source[i] ?? "";
      i++;
      continue;
    }

    out += ch;
    i++;
  }
  return out;
}

/**
 * Every top-level class-member declaration in `masked`, from `searchFrom`
 * onward: `identifier(`, optionally preceded by `private`/`static`/`async`/…
 * and followed by an optional single generic parameter (`<T>`), anchored to
 * exactly two leading spaces of indentation — the class's own member
 * indentation in this file. A statement inside a method body is indented four
 * spaces or more and never matches.
 *
 * This is deliberately *only* a start position, not a full body range: a
 * template is attributed to the closest preceding method-start, and the
 * guard search for a template runs from that method's start to the
 * template's own position. Finding a method's *end* would require reasoning
 * about TypeScript's grammar (a return-type object literal like
 * `(): { x: number } | null {` opens and closes a brace before the real body
 * does), which a text scanner cannot do reliably — and does not need to, since
 * "closest preceding start" is well-defined without it.
 */
function findMethodStarts(masked: string, searchFrom: number): MethodStart[] {
  const pattern =
    /^ {2}(?:(?:private|public|protected|static|async|readonly)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/gm;
  pattern.lastIndex = searchFrom;
  const starts: MethodStart[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(masked))) {
    starts.push({ name: match[1], index: match.index });
  }
  return starts;
}

/** The method whose declaration most closely precedes `index`, or undefined if none does. */
function findEnclosingMethod(methodStarts: MethodStart[], index: number): MethodStart | undefined {
  let best: MethodStart | undefined;
  for (const start of methodStarts) {
    if (start.index <= index && (!best || start.index > best.index)) best = start;
  }
  return best;
}

/**
 * Every backtick template in `masked` whose content starts with `` /${ `` —
 * the shape every request-path template in this file has, and no
 * non-path template (log lines, request ids, error messages) happens to
 * share. Templates in this file are single-line with no nested backtick, so a
 * plain "next backtick" scan delimits them correctly; a future template that
 * violated either assumption would either fail to match `` /${ `` (and so be
 * silently outside this sweep) or be caught by the total-count assertion
 * below, which cross-checks this function's count against one written
 * independently against the live class.
 */
function findPathTemplates(masked: string): PathTemplate[] {
  const templates: PathTemplate[] = [];
  const pattern = /`([^`]*)`/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(masked))) {
    const raw = match[1];
    if (!raw.startsWith("/${")) continue;
    const interpolations = [...raw.matchAll(/\$\{([^}]*)\}/g)].map((m) => ({
      expr: m[1].trim(),
    }));
    const line = masked.slice(0, match.index).split("\n").length;
    templates.push({ index: match.index, line, raw, interpolations });
  }
  return templates;
}

interface Violation {
  line: number;
  method: string;
  expr: string;
  template: string;
  reason: string;
}

/**
 * Whether `expr`, interpolated inside `method` at `templateIndex`, is
 * provably safe — rule (a) or (b) from the module doc comment above.
 */
function isProvenSafe(
  masked: string,
  method: MethodStart,
  templateIndex: number,
  expr: string
): boolean {
  if (EXEMPT_NAMES.has(expr)) return true;

  // Only a bare identifier can be traced to a local binding; a property
  // access or anything more complex either matches an exemption above or
  // fails outright.
  if (!/^[A-Za-z_$][\w$]*$/.test(expr)) return false;

  const window = masked.slice(method.index, templateIndex);
  const guardPattern = new RegExp(
    `\\b(?:const|let)\\s+${expr}\\s*=\\s*(?:assertPathSegment|this\\.normalizeSlug|normalizeAccountSlug)\\s*\\(`
  );
  if (guardPattern.test(window)) return true;

  // The `slug` parameter carve-out described in the module doc comment,
  // narrowly matched on the exact name and a `slug: string` parameter
  // declaration in this method's own signature.
  if (expr === "slug") {
    const signatureWindow = masked.slice(method.index, method.index + 400);
    if (/\bslug\s*:\s*string\b/.test(signatureWindow)) return true;
  }

  return false;
}

/** Run the sweep over `source` (the file content), returning every violation found. */
function findGuardViolations(source: string): Violation[] {
  const masked = blankComments(source);
  const classMatch = /class\s+FizzyClient\b[^{]*\{/.exec(masked);
  if (!classMatch) {
    throw new Error("path-segments sweep: could not find `class FizzyClient { ... }`");
  }
  const classBodyStart = classMatch.index + classMatch[0].length;
  const methodStarts = findMethodStarts(masked, classBodyStart);
  const templates = findPathTemplates(masked);

  const violations: Violation[] = [];
  for (const template of templates) {
    const method = findEnclosingMethod(methodStarts, template.index);
    if (!method) {
      violations.push({
        line: template.line,
        method: "(none)",
        expr: "(n/a)",
        template: template.raw,
        reason: "template could not be attributed to any method",
      });
      continue;
    }
    for (const { expr } of template.interpolations) {
      if (isProvenSafe(masked, method, template.index, expr)) continue;
      violations.push({
        line: template.line,
        method: method.name,
        expr,
        template: template.raw,
        reason: "not a locally-guarded value and not on the exemption list",
      });
    }
  }
  return violations;
}

describe("scanner", () => {
  // Each case below is a minimal class shaped like FizzyClient, so the
  // scanner is exercised the same way it will be against the real file: find
  // the class, find its methods, find its path templates, judge each
  // interpolation. A scanner nobody has tested against known-good and
  // known-bad input is a scanner that can silently stop scanning.
  const wrap = (body: string) => `class FizzyClient {\n${body}\n}\n`;

  it("accepts a value guarded by assertPathSegment in the same method", () => {
    const source = wrap(`
  async getBoard(accountSlug: string, boardId: string) {
    const slug = this.normalizeSlug(accountSlug);
    const board = assertPathSegment(boardId, "board_id");
    return this.request("GET", \`/\${slug}/boards/\${board}\`);
  }`);
    expect(findGuardViolations(source)).toEqual([]);
  });

  it("accepts a value guarded by a direct normalizeAccountSlug(...) call", () => {
    const source = wrap(`
  async getBoard(accountSlug: string) {
    const slug = normalizeAccountSlug(accountSlug);
    return this.request("GET", \`/\${slug}/boards\`);
  }`);
    expect(findGuardViolations(source)).toEqual([]);
  });

  it("rejects a value interpolated with no local guard at all", () => {
    const source = wrap(`
  async getBoard(accountSlug: string, boardId: string) {
    const slug = this.normalizeSlug(accountSlug);
    return this.request("GET", \`/\${slug}/boards/\${boardId}\`);
  }`);
    const violations = findGuardViolations(source);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ method: "getBoard", expr: "boardId" });
  });

  it("does not let a guard in one method cover an interpolation in another", () => {
    const source = wrap(`
  async getBoard(accountSlug: string, boardId: string) {
    const slug = this.normalizeSlug(accountSlug);
    const board = assertPathSegment(boardId, "board_id");
    return this.request("GET", \`/\${slug}/boards/\${board}\`);
  }

  async deleteBoard(accountSlug: string, boardId: string) {
    const slug = this.normalizeSlug(accountSlug);
    return this.request("DELETE", \`/\${slug}/boards/\${board}\`);
  }`);
    const violations = findGuardViolations(source);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ method: "deleteBoard", expr: "board" });
  });

  it.each([...EXEMPT_NAMES])("accepts the exempt name %s with no local guard", (name) => {
    const source = wrap(`
  async getThing(accountSlug: string) {
    const slug = this.normalizeSlug(accountSlug);
    return this.request("GET", \`/\${slug}/things/\${${name}}\`);
  }`);
    expect(findGuardViolations(source)).toEqual([]);
  });

  it("accepts a method's own parameter literally named slug", () => {
    const source = wrap(`
  private attachmentPath(slug: string, ref: AttachmentRef) {
    const filename = encodeURIComponent(ref.filename);
    return \`/\${slug}/rails/active_storage/blobs/redirect/\${ref.signedId}/\${filename}\`;
  }`);
    expect(findGuardViolations(source)).toEqual([]);
  });

  it("does not extend the slug carve-out to a parameter named accountSlug", () => {
    const source = wrap(`
  async getBoards(accountSlug: string) {
    return this.request("GET", \`/\${accountSlug}/boards\`);
  }`);
    const violations = findGuardViolations(source);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ method: "getBoards", expr: "accountSlug" });
  });

  it("ignores a template that does not start with /${ even if it interpolates a raw value", () => {
    const source = wrap(`
  async getBoard(accountSlug: string, boardId: string) {
    this.log.debug(\`Fetching board \${boardId}\`);
    const slug = this.normalizeSlug(accountSlug);
    const board = assertPathSegment(boardId, "board_id");
    return this.request("GET", \`/\${slug}/boards/\${board}\`);
  }`);
    expect(findGuardViolations(source)).toEqual([]);
  });

  it("fails a template it cannot attribute to any method, rather than skipping it", () => {
    const source = `class FizzyClient {
  static readonly BASE = \`/\${badGlobal}/boards\`;

  async getBoard(accountSlug: string) {
    const slug = this.normalizeSlug(accountSlug);
    return this.request("GET", \`/\${slug}/boards\`);
  }
}
`;
    const violations = findGuardViolations(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toMatch(/could not be attributed/);
  });

  it("does not get confused by a return-type object literal before the real body", () => {
    // getCacheStats()/parsePaginationMeta() in the real file have this shape:
    // a `{ ... }` object type in the return position, before the body's own
    // `{`. The scanner only needs each method's *start*, never its end, so
    // this shape cannot desynchronise it the way finding a body's end would.
    const source = wrap(`
  getStats(): { count: number } | null {
    return null;
  }

  async getBoard(accountSlug: string, boardId: string) {
    const slug = this.normalizeSlug(accountSlug);
    const board = assertPathSegment(boardId, "board_id");
    return this.request("GET", \`/\${slug}/boards/\${board}\`);
  }`);
    expect(findGuardViolations(source)).toEqual([]);
  });
});

describe("path segment guards on FizzyClient", () => {
  const source = readFileSync(clientPath, "utf8");

  it("finds the path-like templates the real file actually has", () => {
    // Guards the sweep itself: a scanner that matched nothing would make the
    // assertion below pass vacuously. 54 templates carry the 55 guarded
    // interpolations (plus account_slug and the five exemptions): a template
    // can hold more than one, so the template count and the guarded-value
    // count are not the same number — e.g. removeReaction's single template
    // interpolates card, comment and reaction together.
    const masked = blankComments(source);
    const templates = findPathTemplates(masked);
    expect(templates.length).toBe(54);
  });

  it("proves every interpolation in every request-path template safe", () => {
    const violations = findGuardViolations(source);
    if (violations.length > 0) {
      const details = violations
        .map((v) => `  line ${v.line} (${v.method}): \${${v.expr}} in ${v.template} — ${v.reason}`)
        .join("\n");
      throw new Error(`Unguarded path-segment interpolation(s) found:\n${details}`);
    }
    expect(violations).toEqual([]);
  });
});
