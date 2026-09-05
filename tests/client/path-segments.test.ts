/**
 * A structural sweep of `src/client/fizzy-client.ts`: every request path this
 * file can send to the Fizzy API must be provably built from values this
 * scanner can prove are safe to drop into a URL path segment unguarded.
 *
 * This is what stops a method added later from silently skipping the guard —
 * without it, a new `getWidget(accountSlug, widgetId)` that forgets
 * `assertPathSegment` would compile, pass every other test, and reopen the
 * exact traversal this file exists to close. Follows the precedent of
 * `tests/tools/declared-dependencies.test.ts`: TypeScript 7 is the Go port and
 * ships no JavaScript compiler API, so this reads text rather than an AST.
 *
 * **Two independent, additive checks, because each has a blind spot the other
 * covers.**
 *
 * 1. **The call-site check** (`findCallViolations`) is the primary one, and it
 *    inverts the sweep's original design: instead of looking for template
 *    literals shaped like a path and hoping every path-issuing call happens to
 *    use one, it starts at every call in this file to `this.request<...>(`,
 *    `this.requestAllPages<...>(` and `this.requestWithMeta<...>(` — the only
 *    three ways this file reaches the network — and demands the argument that
 *    supplies the path be provably one of:
 *
 *      (a) a template literal whose every `${...}` interpolation is one of the
 *          exemptions below, or a name bound earlier in the *same* method by
 *          `const NAME = assertPathSegment(...)`, `this.normalizeSlug(...)` or
 *          `normalizeAccountSlug(...)` (or the method's own `slug` parameter —
 *          see "the `slug` parameter" below);
 *      (b) a plain string literal with no interpolation at all (`"/my/identity"`);
 *      (c) a `const` local, bound in the same method, whose initializer is
 *          itself (a) or (b) — including a ternary whose *both* branches are.
 *          `getNotifications` is the real instance of this: it binds
 *          `const path = <cond> ? \`/${slug}/notifications\` : \`/${slug}/notifications?page=${requestedPage}\``
 *          and passes `path`.
 *
 *    Anything else — string concatenation, a call to a path-building helper, a
 *    bare identifier the scanner cannot resolve to a qualifying `const`, a
 *    `let` (guarded or not: see below) — is a violation. There is no escape
 *    hatch for an unrecognised shape; the point is that it fails loudly and a
 *    human looks, rather than the sweep silently deciding it is fine.
 *
 *    This is the check that closes what the template-only design originally
 *    missed: a path built by `` `/${slug}/boards/` + boardId ``, or by
 *    `this.request("GET", this.buildPath(boardId))`, builds no template that
 *    starts where the old scan looked, so the old scan never saw it — the
 *    unguarded `boardId` shipped and the pinned template *count* didn't even
 *    move, because concatenation and a helper call are not templates at all.
 *    Starting from the request call instead of the template closes that by
 *    construction: every path-issuing call is found *because* it is a call to
 *    one of the three request methods, not because its argument happens to
 *    look like a path.
 *
 *    **What this check does not scan.** `request()` and `requestWithMeta()`
 *    call each other (`request` forwards straight to `requestWithMeta`), and
 *    `requestAllPages()` builds its own paginated URL from the `basePath` its
 *    caller already supplied and calls `requestWithMeta` in turn. Those three
 *    calls are the plumbing that *implements* the boundary this check inspects,
 *    not new path construction — the value they forward was already proved at
 *    its own call site, checked here like any other. Scanning them too would
 *    require proving a bare function parameter safe with no local `const` to
 *    point to, which is exactly the escape hatch this design refuses to add.
 *    So a call site is only in scope for this check when it sits in a method
 *    other than `request`, `requestWithMeta` or `requestAllPages` themselves.
 *
 * 2. **The template check** (`findTemplateViolations`) is additive and kept
 *    for what the call-site check cannot see: a path-building method that is
 *    not itself a call to `request`/`requestAllPages`/`requestWithMeta`.
 *    `attachmentPath` is the live example — it returns a template consumed by
 *    `fetchAttachment`, which reaches the network through a raw `fetch`, not
 *    through this file's request layer, so no call-site scan would ever look
 *    at it. This check instead sweeps every backtick template in the file
 *    that looks path-shaped — contains both a `/` and a `${` — regardless of
 *    where it starts, and proves its interpolations the same way. It used to
 *    require the template to start with exactly `` /${ ``, which missed a
 *    template with a literal prefix like `` `/accounts/${slug}/...` ``;
 *    broadening the shape to "contains `/` and `${` anywhere" closes that
 *    without narrowing anything it already caught — every template that
 *    matched the old, narrower rule still starts with `/${` and so still
 *    contains both markers.
 *
 * **Design is default-deny, and picks a direction to be wrong in.** Borrowed
 * directly from declared-dependencies.test.ts: a guard that quietly misses a
 * case stops guarding and nobody finds out; a guard that flags one case too
 * many fails loudly and is fixed in a minute. Both checks here are built to
 * make the second mistake, never the first — an expression shape neither
 * recognises is a violation, not a pass.
 *
 * **Two independent counts are pinned**, not just the "no violations" result:
 * the number of path-shaped templates (54) and the number of in-scope
 * request-issuing call sites (52). A silent scanning regression — a shape
 * that stops matching — would otherwise still report zero violations over
 * fewer things checked. Pinning the *count* each scan actually walked is what
 * turns "found nothing wrong" into "found nothing wrong in the right number of
 * places"; a new call site or template changes one of these numbers no matter
 * which construction shape it uses, and the count assertion is what catches
 * that even before the safety assertion would.
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
 *
 * **`let` is never a guard, reassigned or not.** A value guarded into a `let`
 * (`let board = assertPathSegment(...)`) and never touched again is
 * indistinguishable, to a text scanner, from one reassigned to something
 * unguarded one line later — proving "never reassigned" would need real
 * data-flow analysis, which a regex has no way to do. Rather than attempt
 * that and risk getting it wrong, every guard pattern below requires `const`
 * outright. `fizzy-client.ts` already binds every guarded value with `const`;
 * if a future change genuinely needs a reassignable guarded local, that is a
 * real gap in this scanner's design, not something to paper over by adding
 * `let` back into the pattern.
 *
 * **What neither check can see.** Both read text, not an AST, so a shape
 * outside what is enumerated above is a violation rather than a considered
 * "no" — that is deliberate, but it also means a genuinely new *safe* shape
 * (a third kind of guard function, a `switch` instead of a ternary, two levels
 * of `const` chaining) will fail here and need this file extended, not just
 * the production code. Neither check follows a value across methods or files:
 * a guard applied in one method never covers a use in another, and a path
 * built by something other than `fizzy-client.ts` — a caller of this client,
 * or Fizzy's own server-side routing — is out of scope entirely. The
 * interpolation regex (`\$\{([^}]*)\}`) stops at the first `}`, so an
 * interpolation containing its own object literal would be split wrong; no
 * such interpolation exists in this file today. And neither check re-verifies
 * that `assertPathSegment`, `normalizeSlug` or `normalizeAccountSlug`
 * themselves reject what they claim to — only that they were called; their
 * own correctness is `src/utils/path-segment.ts`'s tests to own, not this
 * file's.
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

/** The three methods a request path can reach the network through. */
const REQUEST_METHOD_NAMES = ["requestAllPages", "requestWithMeta", "request"] as const;
type RequestMethodName = (typeof REQUEST_METHOD_NAMES)[number];

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

/** A source-text span with its own start index, for guard-window lookups on whatever it contains. */
interface Span {
  text: string;
  start: number;
}

/** One call in fizzy-client.ts to a request-issuing method, with its path argument (if found). */
interface RequestCallSite {
  index: number;
  line: number;
  callee: RequestMethodName;
  method: MethodStart;
  pathArg: Span | undefined;
}

interface Violation {
  line: number;
  method: string;
  expr: string;
  template: string;
  reason: string;
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
 * template or call site is attributed to the closest preceding method-start,
 * and any guard search runs from that method's start to the use's own
 * position. Finding a method's *end* would require reasoning about
 * TypeScript's grammar (a return-type object literal like
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

/** The index right after `class FizzyClient { ... {`'s opening brace, in `masked`. */
function classBodyStartOf(masked: string): number {
  const classMatch = /class\s+FizzyClient\b[^{]*\{/.exec(masked);
  if (!classMatch) {
    throw new Error("path-segments sweep: could not find `class FizzyClient { ... }`");
  }
  return classMatch.index + classMatch[0].length;
}

/**
 * Every backtick template in `masked` that looks path-shaped: its content
 * contains both a `/` and a `${`. Templates in this file are single-line with
 * no nested backtick, so a plain "next backtick" scan delimits them
 * correctly; a future template that violated either assumption would either
 * fail to match (and so be silently outside this sweep) or be caught by the
 * total-count assertion below, which cross-checks this function's count
 * against one written independently against the live class.
 *
 * Broadened from an earlier version that required the content to *start*
 * with `` /${ ``: that missed a template with a literal prefix, like
 * `` `/accounts/${slug}/boards/${boardId}` ``, which is exactly the shape a
 * new endpoint might use. Every template that matched the old rule still
 * starts with `/${` and so still contains both markers, so this is a strict
 * widening — nothing previously caught stops being caught.
 */
function findPathTemplates(masked: string): PathTemplate[] {
  const templates: PathTemplate[] = [];
  const pattern = /`([^`]*)`/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(masked))) {
    const raw = match[1];
    if (!(raw.includes("/") && raw.includes("${"))) continue;
    const interpolations = [...raw.matchAll(/\$\{([^}]*)\}/g)].map((m) => ({
      expr: m[1].trim(),
    }));
    const line = masked.slice(0, match.index).split("\n").length;
    templates.push({ index: match.index, line, raw, interpolations });
  }
  return templates;
}

/**
 * Whether `expr`, interpolated inside `method` at `boundary`, is provably
 * safe — rule (a) or (b) from the module doc comment above. `boundary` is the
 * position `expr`'s guard must textually precede — the start of the template
 * or call argument it appears in, not necessarily the position of `${expr}`
 * itself, matching how a `const` guard must precede the whole statement that
 * uses it, not just the one interpolation.
 */
function isProvenSafe(masked: string, method: MethodStart, boundary: number, expr: string): boolean {
  if (EXEMPT_NAMES.has(expr)) return true;

  // Only a bare identifier can be traced to a local binding; a property
  // access or anything more complex either matches an exemption above or
  // fails outright.
  if (!/^[A-Za-z_$][\w$]*$/.test(expr)) return false;

  const window = masked.slice(method.index, boundary);
  // `const` only — see "let is never a guard" in the module doc comment.
  const guardPattern = new RegExp(
    `\\bconst\\s+${expr}\\s*=\\s*(?:assertPathSegment|this\\.normalizeSlug|normalizeAccountSlug)\\s*\\(`
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

/** Run the template sweep over `source`, returning every violation found. */
function findTemplateViolations(source: string): Violation[] {
  const masked = blankComments(source);
  const methodStarts = findMethodStarts(masked, classBodyStartOf(masked));
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

// ============ The call-site scan ============
//
// The functions below implement the primary check described at the top of
// this file: find every call to `this.request(...)` / `this.requestAllPages(...)`
// / `this.requestWithMeta(...)`, extract the argument that supplies the path,
// and require it to be a template, a string literal, or a `const` bound to
// one of those (directly, or via a ternary of both branches).

/**
 * Advance past a single- or double-quoted string, or a backtick template,
 * starting at `s[start]` (one of `"`, `'`, `` ` ``). Returns the index just
 * past the matching closing quote. Backslash escapes are honoured; a
 * template's `${...}` interior is not parsed here — templates this scanner
 * deals with are single-line with no nested backtick (see `blankComments`),
 * so a "next matching quote" scan closes them correctly.
 */
function skipQuoted(s: string, start: number): number {
  const quote = s[start];
  let i = start + 1;
  while (i < s.length && s[i] !== quote) {
    if (s[i] === "\\") {
      i += 2;
      continue;
    }
    i++;
  }
  return Math.min(i + 1, s.length);
}

/** `source.slice(start, end)` with surrounding whitespace trimmed, keeping the trimmed start index. */
function sliceTrimmed(source: string, start: number, end: number): Span {
  let s = start;
  let e = end;
  while (s < e && /\s/.test(source[s])) s++;
  while (e > s && /\s/.test(source[e - 1])) e--;
  return { text: source.slice(s, e), start: s };
}

/**
 * Split a call's argument list into top-level, comma-separated arguments,
 * given the index of its opening `(`. Tracks nesting depth across
 * `()`/`[]`/`{}` and skips over string/template literals wholesale (via
 * `skipQuoted`), so a comma inside an object-literal argument — `{ card: data }`
 * — or inside a template's own text never splits an argument in two.
 */
function parseCallArguments(masked: string, openParenIndex: number): Span[] {
  let i = openParenIndex + 1;
  let depth = 0;
  let currentStart = i;
  const args: Span[] = [];
  while (i < masked.length) {
    const ch = masked[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipQuoted(masked, i);
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      i++;
      continue;
    }
    if (ch === ")" && depth === 0) {
      args.push(sliceTrimmed(masked, currentStart, i));
      return args;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      i++;
      continue;
    }
    if (ch === "," && depth === 0) {
      args.push(sliceTrimmed(masked, currentStart, i));
      currentStart = i + 1;
      i++;
      continue;
    }
    i++;
  }
  throw new Error("path-segments sweep: unterminated call (unbalanced parens)");
}

/**
 * From `index`, skip whitespace, then an optional generic clause (`<T>`,
 * depth-aware so `<FizzyCard[]>` closes correctly), then whitespace again.
 * Returns the index of what should be the call's opening `(`.
 */
function skipOptionalGenericAndWhitespace(masked: string, index: number): number {
  let i = index;
  while (i < masked.length && /\s/.test(masked[i])) i++;
  if (masked[i] === "<") {
    let depth = 0;
    while (i < masked.length) {
      if (masked[i] === "<") depth++;
      else if (masked[i] === ">") {
        depth--;
        i++;
        if (depth === 0) break;
        continue;
      }
      i++;
    }
  }
  while (i < masked.length && /\s/.test(masked[i])) i++;
  return i;
}

/** The index of the first top-level `;` at or after `start` (depth 0, outside any string/template), or -1. */
function findTopLevelSemicolon(masked: string, start: number): number {
  let i = start;
  let depth = 0;
  while (i < masked.length) {
    const ch = masked[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipQuoted(masked, i);
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      i++;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      i++;
      continue;
    }
    if (ch === ";" && depth === 0) return i;
    i++;
  }
  return -1;
}

/**
 * Split `text` on its own top-level `? ... : ...`, if it has one at depth 0
 * outside any string/template — e.g. `cond ? a : b`, but not `a?.b` or `a ?? b`.
 * Only a single, unnested ternary is recognised: a branch that is itself
 * another ternary is not split further and will fail `classifyPathExpr`'s
 * literal/string check on the next call, which is the intended over-report —
 * rule (c) in the module doc comment describes exactly one ternary level.
 */
function splitTopLevelTernary(text: string): { branch1: string; branch2: string } | null {
  let depth = 0;
  let qIndex = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipQuoted(text, i) - 1;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      continue;
    }
    if (depth === 0 && ch === "?" && text[i + 1] !== "." && text[i + 1] !== "?" && text[i - 1] !== "?") {
      qIndex = i;
      break;
    }
  }
  if (qIndex === -1) return null;

  let depth2 = 0;
  let colonIndex = -1;
  for (let i = qIndex + 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipQuoted(text, i) - 1;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth2++;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth2--;
      continue;
    }
    if (depth2 === 0 && ch === ":") {
      colonIndex = i;
      break;
    }
  }
  if (colonIndex === -1) return null;

  return {
    branch1: text.slice(qIndex + 1, colonIndex).trim(),
    branch2: text.slice(colonIndex + 1).trim(),
  };
}

/**
 * Find `const name = <initializer>;`, the last such declaration textually
 * before `positionOfUse` in `method` — i.e. the one actually in scope at the
 * use — and return its initializer's text and start index. `let` never
 * matches: see "`let` is never a guard" in the module doc comment. Returns
 * null when no qualifying declaration exists in this method.
 */
function resolveConstInitializer(
  masked: string,
  method: MethodStart,
  positionOfUse: number,
  name: string
): Span | null {
  const window = masked.slice(method.index, positionOfUse);
  const declPattern = new RegExp(`\\bconst\\s+${name}\\s*=\\s*`, "g");
  let match: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;
  while ((match = declPattern.exec(window))) last = match;
  if (!last) return null;

  const initStart = method.index + last.index + last[0].length;
  const semicolonIndex = findTopLevelSemicolon(masked, initStart);
  if (semicolonIndex === -1) return null;
  return sliceTrimmed(masked, initStart, semicolonIndex);
}

interface Classification {
  ok: boolean;
  reason?: string;
}

/**
 * Whether `text` — the source text of a request call's path argument, a
 * ternary branch, or a resolved `const` initializer — is one of the provably
 * safe shapes from rule (a)/(b)/(c) in the module doc comment.
 *
 * `boundary` is passed through unchanged into ternary-branch recursion (both
 * branches belong to the same statement, so the same guard window applies),
 * and updated to the initializer's own start when resolving a `const` — a
 * guard must precede the `const` statement that uses it, not merely the
 * request call that eventually consumes the resolved value.
 *
 * `allowIdentifier` is true only for the top-level call argument: rule (c)
 * resolves one `const` hop, not a chain, so a ternary branch or a resolved
 * initializer that is itself a bare identifier is a violation, not a further
 * lookup.
 */
function classifyPathExpr(
  masked: string,
  method: MethodStart,
  text: string,
  boundary: number,
  allowTernary: boolean,
  allowIdentifier: boolean
): Classification {
  if (text.length === 0) return { ok: false, reason: "empty path argument" };

  if (text[0] === "`") {
    if (skipQuoted(text, 0) !== text.length) {
      return { ok: false, reason: "not a single template literal — likely string concatenation" };
    }
    const interpolations = [...text.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1].trim());
    for (const expr of interpolations) {
      if (!isProvenSafe(masked, method, boundary, expr)) {
        return {
          ok: false,
          reason: `interpolation \${${expr}} is not a locally-guarded value and not on the exemption list`,
        };
      }
    }
    return { ok: true };
  }

  if (text[0] === '"' || text[0] === "'") {
    if (skipQuoted(text, 0) !== text.length) {
      return { ok: false, reason: "not a single string literal — likely string concatenation" };
    }
    return { ok: true };
  }

  if (allowTernary) {
    const split = splitTopLevelTernary(text);
    if (split) {
      const left = classifyPathExpr(masked, method, split.branch1, boundary, false, false);
      if (!left.ok) return { ok: false, reason: `ternary "then" branch: ${left.reason}` };
      const right = classifyPathExpr(masked, method, split.branch2, boundary, false, false);
      if (!right.ok) return { ok: false, reason: `ternary "else" branch: ${right.reason}` };
      return { ok: true };
    }
  }

  if (allowIdentifier && /^[A-Za-z_$][\w$]*$/.test(text)) {
    const resolved = resolveConstInitializer(masked, method, boundary, text);
    if (!resolved) {
      return {
        ok: false,
        reason: `bare identifier "${text}" does not resolve to a \`const ${text} = ...\` bound earlier in this method`,
      };
    }
    return classifyPathExpr(masked, method, resolved.text, resolved.start, true, false);
  }

  return {
    ok: false,
    reason: "not a template literal, a string literal, or a resolvable const — construction not recognised",
  };
}

/**
 * Every call in `masked` to `this.request<...>(`, `this.requestAllPages<...>(`
 * or `this.requestWithMeta<...>(`, with its path argument located — arg 0 for
 * `requestAllPages` (its only parameter), arg 1 for the other two (arg 0 is
 * the HTTP method string). Excludes calls whose enclosing method is one of
 * those same three names: see "what this check does not scan" in the module
 * doc comment.
 */
function findRequestCallSites(masked: string, methodStarts: MethodStart[]): RequestCallSite[] {
  const sites: RequestCallSite[] = [];
  const pattern = /this\.(requestAllPages|requestWithMeta|request)\b/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(masked))) {
    const callee = m[1] as RequestMethodName;
    const openParenIndex = skipOptionalGenericAndWhitespace(masked, m.index + m[0].length);
    if (masked[openParenIndex] !== "(") continue; // not actually a call — does not occur in this file today
    const args = parseCallArguments(masked, openParenIndex);
    const line = masked.slice(0, m.index).split("\n").length;
    const method = findEnclosingMethod(methodStarts, m.index);

    if (!method) {
      sites.push({ index: m.index, line, callee, method: { name: "(none)", index: -1 }, pathArg: undefined });
      continue;
    }
    if ((REQUEST_METHOD_NAMES as readonly string[]).includes(method.name)) continue;

    const pathArgIndex = callee === "requestAllPages" ? 0 : 1;
    sites.push({ index: m.index, line, callee, method, pathArg: args[pathArgIndex] });
  }
  return sites;
}

/** Run the call-site sweep over `source`, returning every violation found. */
function findCallViolations(source: string): Violation[] {
  const masked = blankComments(source);
  const methodStarts = findMethodStarts(masked, classBodyStartOf(masked));
  const sites = findRequestCallSites(masked, methodStarts);

  const violations: Violation[] = [];
  for (const site of sites) {
    if (site.method.index === -1) {
      violations.push({
        line: site.line,
        method: "(none)",
        expr: "(n/a)",
        template: `this.${site.callee}(...)`,
        reason: "call could not be attributed to any method",
      });
      continue;
    }
    if (!site.pathArg) {
      violations.push({
        line: site.line,
        method: site.method.name,
        expr: "(n/a)",
        template: `this.${site.callee}(...)`,
        reason: `this.${site.callee} call is missing its path argument`,
      });
      continue;
    }
    const result = classifyPathExpr(masked, site.method, site.pathArg.text, site.pathArg.start, true, true);
    if (!result.ok) {
      violations.push({
        line: site.line,
        method: site.method.name,
        expr: site.pathArg.text,
        template: `this.${site.callee}(...)`,
        reason: result.reason ?? "not provably safe",
      });
    }
  }
  return violations;
}

describe("template scanner", () => {
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
    expect(findTemplateViolations(source)).toEqual([]);
  });

  it("accepts a value guarded by a direct normalizeAccountSlug(...) call", () => {
    const source = wrap(`
  async getBoard(accountSlug: string) {
    const slug = normalizeAccountSlug(accountSlug);
    return this.request("GET", \`/\${slug}/boards\`);
  }`);
    expect(findTemplateViolations(source)).toEqual([]);
  });

  it("rejects a value interpolated with no local guard at all", () => {
    const source = wrap(`
  async getBoard(accountSlug: string, boardId: string) {
    const slug = this.normalizeSlug(accountSlug);
    return this.request("GET", \`/\${slug}/boards/\${boardId}\`);
  }`);
    const violations = findTemplateViolations(source);
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
    const violations = findTemplateViolations(source);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ method: "deleteBoard", expr: "board" });
  });

  it.each([...EXEMPT_NAMES])("accepts the exempt name %s with no local guard", (name) => {
    const source = wrap(`
  async getThing(accountSlug: string) {
    const slug = this.normalizeSlug(accountSlug);
    return this.request("GET", \`/\${slug}/things/\${${name}}\`);
  }`);
    expect(findTemplateViolations(source)).toEqual([]);
  });

  it("accepts a method's own parameter literally named slug", () => {
    const source = wrap(`
  private attachmentPath(slug: string, ref: AttachmentRef) {
    const filename = encodeURIComponent(ref.filename);
    return \`/\${slug}/rails/active_storage/blobs/redirect/\${ref.signedId}/\${filename}\`;
  }`);
    expect(findTemplateViolations(source)).toEqual([]);
  });

  it("does not extend the slug carve-out to a parameter named accountSlug", () => {
    const source = wrap(`
  async getBoards(accountSlug: string) {
    return this.request("GET", \`/\${accountSlug}/boards\`);
  }`);
    const violations = findTemplateViolations(source);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ method: "getBoards", expr: "accountSlug" });
  });

  it("ignores a template with an interpolation but no / at all", () => {
    const source = wrap(`
  async getBoard(accountSlug: string, boardId: string) {
    this.log.debug(\`Fetching board \${boardId}\`);
    const slug = this.normalizeSlug(accountSlug);
    const board = assertPathSegment(boardId, "board_id");
    return this.request("GET", \`/\${slug}/boards/\${board}\`);
  }`);
    expect(findTemplateViolations(source)).toEqual([]);
  });

  it("ignores a template with a / but no interpolation at all", () => {
    const source = wrap(`
  async getBoard(accountSlug: string, boardId: string) {
    this.log.debug(\`GET /boards request starting\`);
    const slug = this.normalizeSlug(accountSlug);
    const board = assertPathSegment(boardId, "board_id");
    return this.request("GET", \`/\${slug}/boards/\${board}\`);
  }`);
    expect(findTemplateViolations(source)).toEqual([]);
  });

  it("catches a path-shaped template with a literal prefix, not only /${ ", () => {
    // The shape the /${ -only rule used to miss entirely: a literal segment
    // before the first interpolation. Broadening the match condition is what
    // makes this template visible to the sweep at all.
    const source = wrap(`
  async getBoard(accountSlug: string, boardId: string) {
    const slug = this.normalizeSlug(accountSlug);
    return this.request("GET", \`/accounts/\${slug}/boards/\${boardId}\`);
  }`);
    const violations = findTemplateViolations(source);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ method: "getBoard", expr: "boardId" });
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
    const violations = findTemplateViolations(source);
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
    expect(findTemplateViolations(source)).toEqual([]);
  });
});

describe("call-site scanner", () => {
  // Same fixture shape as the template-scanner suite above, exercising
  // findCallViolations instead: find the class, find its request calls,
  // classify each one's path argument.
  const wrap = (body: string) => `class FizzyClient {\n${body}\n}\n`;

  it("rejects a path built by string concatenation", () => {
    const source = wrap(`
  async getBoard(accountSlug: string, boardId: string) {
    const slug = this.normalizeSlug(accountSlug);
    return this.request("GET", \`/\${slug}/boards/\` + boardId);
  }`);
    const violations = findCallViolations(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].method).toBe("getBoard");
    expect(violations[0].reason).toMatch(/concatenation/);
  });

  it("rejects a template with a literal prefix that interpolates an unguarded id", () => {
    const source = wrap(`
  async getBoard(accountSlug: string, boardId: string) {
    const slug = this.normalizeSlug(accountSlug);
    return this.request("GET", \`/accounts/\${slug}/boards/\${boardId}\`);
  }`);
    const violations = findCallViolations(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].method).toBe("getBoard");
    expect(violations[0].reason).toContain("boardId");
  });

  it("rejects a path routed through an intermediate helper call", () => {
    const source = wrap(`
  async getBoard(accountSlug: string, boardId: string) {
    const board = assertPathSegment(boardId, "board_id");
    return this.request("GET", this.buildPath(board));
  }`);
    const violations = findCallViolations(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].method).toBe("getBoard");
    expect(violations[0].reason).toMatch(/not recognised/);
  });

  it("rejects a value guarded into a let and reassigned before use", () => {
    const source = wrap(`
  async getBoard(accountSlug: string, boardId: string) {
    const slug = this.normalizeSlug(accountSlug);
    let board = assertPathSegment(boardId, "board_id");
    board = boardId;
    return this.request("GET", \`/\${slug}/boards/\${board}\`);
  }`);
    const violations = findCallViolations(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].method).toBe("getBoard");
    expect(violations[0].reason).toContain("board");
  });

  it("rejects a request call whose path argument is a bare unresolvable identifier", () => {
    const source = wrap(`
  async getBoard(accountSlug: string): Promise<unknown> {
    return this.request("GET", somePath);
  }`);
    const violations = findCallViolations(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].method).toBe("getBoard");
    expect(violations[0].reason).toMatch(/does not resolve/);
  });

  it("accepts a const path bound to a ternary of two guarded templates", () => {
    // getNotifications's real shape: page 1 must stay page-less, so the path
    // is chosen by a ternary rather than always carrying a query string.
    const source = wrap(`
  async getNotifications(accountSlug: string, requestedPage: number): Promise<unknown> {
    const slug = this.normalizeSlug(accountSlug);
    const path =
      requestedPage === 1
        ? \`/\${slug}/notifications\`
        : \`/\${slug}/notifications?page=\${requestedPage}\`;
    return this.request("GET", path);
  }`);
    expect(findCallViolations(source)).toEqual([]);
  });

  it("accepts a plain string-literal path with no interpolation", () => {
    const source = wrap(`
  async getIdentity(): Promise<unknown> {
    return this.request("GET", "/my/identity");
  }`);
    expect(findCallViolations(source)).toEqual([]);
  });

  it("accepts requestAllPages's single basePath argument directly", () => {
    const source = wrap(`
  async getBoards(accountSlug: string): Promise<unknown[]> {
    const slug = this.normalizeSlug(accountSlug);
    return this.requestAllPages(\`/\${slug}/boards\`);
  }`);
    expect(findCallViolations(source)).toEqual([]);
  });

  it("does not require request()/requestWithMeta()'s own mutual forwarding to prove a const", () => {
    // request() forwards its own `path` parameter straight to
    // requestWithMeta() — plumbing underneath the boundary this check
    // inspects, not new construction. See "what this check does not scan" in
    // the module doc comment.
    const source = wrap(`
  private async request(method: string, path: string, body?: unknown) {
    const { data } = await this.requestWithMeta(method, path, body);
    return data;
  }

  private async requestWithMeta(method: string, path: string, body?: unknown) {
    return { data: null, meta: undefined };
  }

  async getIdentity(): Promise<unknown> {
    return this.request("GET", "/my/identity");
  }`);
    expect(findCallViolations(source)).toEqual([]);
  });
});

describe("path segment guards on FizzyClient", () => {
  const source = readFileSync(clientPath, "utf8");

  it("finds the path-like templates the real file actually has", () => {
    // Guards the template sweep itself: a scanner that matched nothing would
    // make the assertion below pass vacuously. 54 templates carry the 55
    // guarded interpolations (plus account_slug and the five exemptions): a
    // template can hold more than one, so the template count and the
    // guarded-value count are not the same number — e.g. removeReaction's
    // single template interpolates card, comment and reaction together.
    const masked = blankComments(source);
    const templates = findPathTemplates(masked);
    expect(templates.length).toBe(54);
  });

  it("finds the request-issuing call sites the real file actually has", () => {
    // Guards the call-site sweep the same way: a scanner that stopped
    // matching request calls would make the assertion below pass vacuously.
    // 52 is every call to request()/requestAllPages()/requestWithMeta() in a
    // method other than those three themselves — see "what this check does
    // not scan" in the module doc comment for the two calls this excludes.
    const masked = blankComments(source);
    const methodStarts = findMethodStarts(masked, classBodyStartOf(masked));
    const sites = findRequestCallSites(masked, methodStarts);
    expect(sites.length).toBe(52);
  });

  it("proves every interpolation in every path-shaped template safe", () => {
    const violations = findTemplateViolations(source);
    if (violations.length > 0) {
      const details = violations
        .map((v) => `  line ${v.line} (${v.method}): \${${v.expr}} in ${v.template} — ${v.reason}`)
        .join("\n");
      throw new Error(`Unguarded path-segment interpolation(s) found:\n${details}`);
    }
    expect(violations).toEqual([]);
  });

  it("proves every request call's path argument safe", () => {
    const violations = findCallViolations(source);
    if (violations.length > 0) {
      const details = violations
        .map((v) => `  line ${v.line} (${v.method}): ${v.template} argument \`${v.expr}\` — ${v.reason}`)
        .join("\n");
      throw new Error(`Unproven request path argument(s) found:\n${details}`);
    }
    expect(violations).toEqual([]);
  });
});
