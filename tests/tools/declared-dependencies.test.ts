/**
 * Every package `src/` imports at runtime must be declared in `dependencies`.
 *
 * `zod-to-json-schema` was imported by tools/json-schema.ts without ever being
 * declared: it resolved only because `@modelcontextprotocol/sdk` depends on it
 * and npm hoisted a copy. That works until a dependency bump changes the
 * hoisting or the SDK drops the dependency, at which point the build fails on a
 * module the package never asked for — and the published package is missing it
 * for consumers regardless, since npm installs declared dependencies, not the
 * ones that happened to be present in this checkout.
 *
 * Only `src/` is swept. Tests may import devDependencies freely; nothing under
 * tests/ ships.
 *
 * **On the scanner, and which way it is allowed to be wrong.** This reads text
 * rather than an AST: TypeScript 7 is the Go port and ships no JavaScript
 * compiler API (`ts.createSourceFile` is undefined), and the only bundlers on
 * hand — esbuild via vitest and tsx — are themselves undeclared transitives, so
 * parsing with one would reintroduce the exact dependency this file exists to
 * catch.
 *
 * Text scanning cannot be exact, so the design picks a direction: it
 * **over-reports rather than under-reports**. A guard that misses an import
 * silently stops guarding and nobody finds out; a guard that flags one name too
 * many fails loudly, names the file, and is fixed in a minute.
 *
 * So the two halves are scanned differently:
 *
 * - **Call forms** (`import(…)`, `require(…)`) are matched over the source
 *   exactly as written — inside comments, strings, templates, regex literals and
 *   member calls alike. Any call-shaped sequence of those characters is
 *   reported, whether or not it is code. This is what makes them immune to every
 *   lexing bug that has bitten this file: they do not depend on the lexer at
 *   all. `loader.require("x")` and `/require("x")/` are reported too; that is
 *   the price, and it is paid loudly.
 * - **Statement forms** (`import … from`, `export … from`) are matched over
 *   masked source, outside string literals, because import-shaped *prose* is far
 *   likelier than a stray statement and the syntax is unambiguous.
 *
 * `describe("scanner")` below pins every form the sweep must catch and every
 * form it must ignore, so a form falling outside the patterns fails here
 * instead of silently disarming the guard.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Runtimes provide these; they are never installed. */
const BUILTIN_PREFIXES = ["node:", "cloudflare:"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}

/**
 * Delimits a string-literal placeholder in masked source. NUL is used because
 * a placeholder must not collide with real source: a raw NUL outside a literal
 * is emitted as itself, and would have to be followed by digits and another NUL
 * in an import position to be misread — which is not valid TypeScript anyway.
 */
const LITERAL = String.fromCharCode(0);

/** `\0N\0` — the placeholder a masked string literal leaves behind. */
const PLACEHOLDER = `${LITERAL}(\\d+)${LITERAL}`;

interface MaskedSource {
  /** Source with comments blanked and every string literal replaced by a placeholder. */
  text: string;
  /** Literal contents, indexed by the number in the placeholder. */
  literals: string[];
}

/**
 * Blank comments and replace every string literal — quoted or backticked —
 * with an opaque placeholder, keeping the contents in a side table.
 *
 * Comments must go, or prose like `// copied from the "pkg" docs` reads as an
 * import. A removed comment leaves a space behind, because
 * `import/* c *\/x from "pkg"` is legal TypeScript and welding the halves into
 * `importx` would hide a real dependency.
 *
 * This output feeds the *statement* patterns only. The call forms read raw
 * source and never touch it, which is deliberate: every defect this file has had
 * came from asking a regex-based lexer to understand more TypeScript than it
 * could. A frame stack that lexed template substitutions was desynchronised by a
 * regex literal containing `}`; replacing it with whole-template masking then
 * mis-delimited nested templates, and a `//` inside the inner one swallowed the
 * code after it. Both were silent under-reports. Nothing load-bearing depends on
 * this lexer any more — a template containing a nested template is still
 * delimited wrongly, and the consequence is confined to statement matching
 * inside a construct that is not an import site.
 */
function maskSource(source: string): MaskedSource {
  const literals: string[] = [];
  let text = "";
  let i = 0;

  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];

    if (char === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      // The newline itself is left for the next iteration to emit.
      text += " ";
      continue;
    }

    if (char === "/" && next === "*") {
      i += 2;
      // A space stands in for the comment, so the tokens either side stay
      // separate; newlines are kept so statement-anchored patterns still work.
      let replacement = " ";
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") replacement += "\n";
        i++;
      }
      text += replacement;
      i += 2;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      i++;
      let contents = "";
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\") {
          contents += source[i] + (source[i + 1] ?? "");
          i += 2;
          continue;
        }
        contents += source[i++];
      }
      i++; // closing quote
      text += `${LITERAL}${literals.length}${LITERAL}`;
      literals.push(contents);
      continue;
    }

    text += source[i++];
  }

  return { text, literals };
}

/**
 * The package name a specifier resolves to: `@scope/pkg/deep/path` → `@scope/pkg`,
 * `pkg/deep/path` → `pkg`.
 */
function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/**
 * Decode a specifier's escape sequences, so an escaped spelling is recognised
 * as the package it resolves to rather than reported as an undeclared package
 * named after the escape text.
 *
 * Only literals containing a backslash pay for this, and only the escapes JSON
 * shares with TypeScript are decoded — a name outside that set (`\x7a`,
 * `\u{7a}`) falls back to the raw text, which is the pre-existing behaviour
 * rather than a new failure. No specifier in `src/` is escaped at all.
 */
function decodeSpecifier(raw: string): string {
  if (!raw.includes("\\")) return raw;
  try {
    return JSON.parse(`"${raw.replace(/"/g, '\\"')}"`) as string;
  } catch {
    return raw;
  }
}

/** Whitespace as the language defines it, not just the ASCII four. */
const WHITESPACE = /\s/;

/** Line terminators that end a `//` comment. Sticky-scanned, so set lastIndex first. */
const LINE_TERMINATOR = /[\n\r\u2028\u2029]/g;

/**
 * Advance past whitespace and comments. Used only by `callFormSpecifiers`, and
 * hand-written rather than folded into its patterns: a regex gap that admitted
 * comments as an alternation under a `*` backtracked catastrophically, taking 86
 * seconds on 200 KB of consecutive whitespace before failing. This is linear and
 * cannot.
 */
function skipGap(source: string, from: number): number {
  let i = from;
  while (i < source.length) {
    const char = source[i];
    // `\s` rather than a hand-listed set: the language counts form feed,
    // vertical tab, NBSP and the Unicode space separators as whitespace too, and
    // listing only the four obvious ASCII ones made `import\f("p")` a miss.
    if (WHITESPACE.test(char)) {
      i++;
      continue;
    }
    if (char === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (char === "/" && source[i + 1] === "/") {
      // A line comment ends at any line terminator, which includes U+2028 and
      // U+2029 — not just `\n`.
      LINE_TERMINATOR.lastIndex = i + 2;
      const end = LINE_TERMINATOR.exec(source);
      i = end === null ? source.length : end.index;
      continue;
    }
    break;
  }
  return i;
}

/**
 * Specifiers passed to `import(…)` or `require(…)`, read straight off the source
 * with no lexing of the surrounding code.
 *
 * This is the half of the sweep that must not have blind spots, so it is a
 * scanner rather than a pattern: from each `import` or `require` token it steps
 * over any whitespace and comments, an optional `?.`, the open paren, and reads
 * the quoted first argument, accepting `,` as well as `)` after it so import
 * attributes (`import("p", { with: { type: "json" } })`) still match. Anything
 * that does not fit that shape is skipped, including the `import` of an ordinary
 * `import … from` statement, which the statement patterns handle.
 */
function callFormSpecifiers(source: string): string[] {
  const specifiers: string[] = [];

  for (const match of source.matchAll(/\b(?:import|require)\b/g)) {
    let i = skipGap(source, (match.index ?? 0) + match[0].length);
    if (source.startsWith("?.", i)) i = skipGap(source, i + 2);
    if (source[i] !== "(") continue;

    i = skipGap(source, i + 1);
    const quote = source[i];
    if (quote !== '"' && quote !== "'" && quote !== "`") continue;

    i++;
    let contents = "";
    while (i < source.length && source[i] !== quote) {
      if (source[i] === "\\") {
        contents += source[i] + (source[i + 1] ?? "");
        i += 2;
        continue;
      }
      contents += source[i++];
    }
    if (i >= source.length) continue; // unterminated literal

    i = skipGap(source, i + 1);
    if (source[i] === "," || source[i] === ")") specifiers.push(contents);
  }

  return specifiers;
}

/**
 * Whether an import/export clause binds only types, and so is erased at compile
 * time. Covers `import { type A, type B } from "p"` — the statement-level
 * `import type` form is handled by the caller. A clause with a default or
 * namespace binding alongside the braces always binds a value.
 */
function bindsOnlyTypes(clause: string): boolean {
  const braces = clause.match(/^\s*\{([^}]*)\}\s*$/);
  if (!braces) return false;

  const specifiers = braces[1]
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");

  return specifiers.length > 0 && specifiers.every((entry) => /^type\s/.test(entry));
}

/**
 * Bare-module specifiers a file imports for their *values*.
 *
 * Type-only imports are skipped: TypeScript erases them, so a types-only
 * package (`@cloudflare/workers-types`) is correctly a devDependency and would
 * otherwise be a false positive.
 */
export function runtimeImports(rawSource: string): string[] {
  const { text, literals } = maskSource(rawSource);
  const found = new Set<string>();

  const add = (raw: string) => {
    const specifier = decodeSpecifier(raw);
    // An interpolated specifier resolves at runtime and cannot be attributed to
    // a package here.
    if (specifier.includes("${")) return;
    if (specifier === "") return;
    if (specifier.startsWith(".") || specifier.startsWith("/")) return;
    if (BUILTIN_PREFIXES.some((prefix) => specifier.startsWith(prefix))) return;
    found.add(packageName(specifier));
  };

  const addByIndex = (index: string) => {
    const raw = literals[Number(index)];
    if (raw !== undefined) add(raw);
  };

  // Statement forms, over masked text so import-shaped prose inside a string
  // is not mistaken for one. `import x from "p"`, `import {a} from "p"`,
  // `export * from "p"`, `export {a} from "p"`, and every whitespace-free
  // variant. The clause excludes the placeholder delimiter, parens and
  // semicolons, so a match cannot run past the end of its own statement.
  const statementFrom = new RegExp(
    `(?:^|[\\s;})])(import|export)\\b(\\s*type\\b)?([^${LITERAL}();]*?)\\bfrom\\s*${PLACEHOLDER}`,
    "g"
  );
  for (const match of text.matchAll(statementFrom)) {
    const [, , typeKeyword, clause, index] = match;
    if (typeKeyword) continue;
    if (bindsOnlyTypes(clause)) continue;
    addByIndex(index);
  }

  // Side-effect import: `import "p"`, with no clause at all.
  for (const match of text.matchAll(
    new RegExp(`(?:^|[\\s;})])import\\s*${PLACEHOLDER}`, "g")
  )) {
    addByIndex(match[1]);
  }

  // `import x = require("p")`, over masked text: the binding name makes this
  // unambiguous, and it is a statement rather than a bare call.
  for (const match of text.matchAll(
    new RegExp(
      `(?:^|[\\s;})])import\\s+[A-Za-z_$][\\w$]*\\s*=\\s*require\\s*\\(\\s*${PLACEHOLDER}\\s*\\)`,
      "g"
    )
  )) {
    addByIndex(match[1]);
  }

  // Call forms, over the source exactly as written — comments, strings,
  // templates and all. Reading raw is the whole point: it is why a dynamic
  // import inside a template substitution is caught without lexing the
  // substitution, and why no future lexer bug can hide one.
  for (const specifier of callFormSpecifiers(rawSource)) add(specifier);

  return [...found];
}

describe("scanner", () => {
  // A guard nobody has tested is a guard that quietly stops guarding, so each
  // form is pinned here rather than assumed. Several of these are regressions:
  // earlier versions of this file missed re-exports, missed whitespace-free
  // imports, welded `import/* c */x` into `importx`, and lost a dynamic import
  // inside a template substitution.
  it.each([
    ["a default import", 'import x from "pkg";'],
    ["a named import", 'import { a } from "pkg";'],
    ["a whitespace-free named import", 'import{a}from"pkg";'],
    ["a namespace import", 'import * as x from "pkg";'],
    ["a side-effect import", 'import "pkg";'],
    ["a whitespace-free side-effect import", 'import"pkg";'],
    ["a re-export", 'export { a } from "pkg";'],
    ["a whitespace-free re-export", 'export{a}from"pkg";'],
    ["a star re-export", 'export * from "pkg";'],
    ["a namespaced star re-export", 'export * as ns from "pkg";'],
    ["a mixed value/type import", 'import { a, type B } from "pkg";'],
    ["a dynamic import", 'const m = await import("pkg");'],
    ["a require", 'const m = require("pkg");'],
    ["an import-equals-require", 'import m = require("pkg");'],
    ["a deep path", 'import x from "pkg/deep/path.js";'],
    ["a single-quoted specifier", "import x from 'pkg';"],
    ["an import after a closing brace", 'function f() {}\nimport x from "pkg";'],
    // Legal, if unusual. Removing the comment without leaving whitespace welds
    // the tokens into `importx` and the import vanishes from the sweep.
    ["a block comment wedged against the keyword", 'import/* c */x from "pkg";'],
    ["a block comment inside the clause", 'import { /* c */ a } from "pkg";'],
    ["a line comment inside the statement", 'import // c\n x from "pkg";'],
    // A template substitution holds real code. Scanning the call forms over raw
    // source catches these without lexing the substitution.
    ["a dynamic import inside a template substitution", 'const v = `${await import("pkg")}`;'],
    ["a require inside a template substitution", 'const v = `${require("pkg")}`;'],
    ["a dynamic import nested two templates deep", 'const v = `${`${await import("pkg")}`}`;'],
    [
      "a dynamic import after a braced expression in the same substitution",
      'const v = `${ {a: 1} && await import("pkg") }`;',
    ],
    [
      "a dynamic import after a regex containing a brace",
      'const v = `${/\\}/.test("}") && await import("pkg")}`;',
    ],
    [
      "a dynamic import after a nested template holding a slash pair",
      'const v = `${`// text`}${await import("pkg")}`;',
    ],
    ["an optional dynamic import", 'const m = await import?.("pkg");'],
    ["an optional require", 'const m = require?.("pkg");'],
    [
      "a dynamic import with import attributes",
      'const data = await import("pkg", { with: { type: "json" } });',
    ],
    ["a comment between the keyword and the paren", 'await import/* c */("pkg");'],
    ["a comment after the specifier", 'await import("pkg" /* c */);'],
    ["a comment before the specifier", 'await import(/* c */ "pkg");'],
    ["a comment in a require call", 'require/* c */("pkg");'],
    ["a line comment inside the call", 'await import(\n  // c\n  "pkg"\n);'],
    ["a form feed before the paren", 'const m = await import\f("pkg");'],
    ["a vertical tab before the paren", 'const m = await import\v("pkg");'],
    ["a non-breaking space before the paren", 'const m = await import\u00a0("pkg");'],
    ["a line comment ended by U+2028", 'await import(// c\u2028"pkg");'],
    ["a line comment ended by U+2029", 'await import(// c\u2029"pkg");'],
    ["a template with no substitution as a specifier", "const v = await import(`pkg`);"],
    ["an escaped specifier", 'import z from "\\u0070kg";'],
  ])("detects %s", (_label, source) => {
    expect(runtimeImports(source)).toEqual(["pkg"]);
  });

  // The accepted cost. The call forms read raw source, so *any* call-shaped
  // sequence of those characters is reported — in a string, a comment, a regex
  // literal, or as somebody else's method. Telling those apart needs a parser,
  // and reporting one name too many is the failure this scanner is willing to
  // have: it fails loudly and takes a minute to fix, where a miss would sit
  // there looking like protection.
  it.each([
    ["a require call quoted in a string", `const prose = 'require("pkg")';`],
    ["a dynamic import quoted in a string", `const prose = 'import("pkg")';`],
    ["a require call inside a template literal", "const prose = `require(\"pkg\")`;"],
    ["a commented-out dynamic import", '// const m = await import("pkg");'],
    ["a call shape inside a regex literal", 'const re = /require("pkg")/;'],
    ["an unrelated method named require", 'loader.require("pkg");'],
  ])("over-reports %s", (_label, source) => {
    expect(runtimeImports(source)).toEqual(["pkg"]);
  });

  it.each([
    ["a statement-level type import", 'import type { A } from "pkg";'],
    ["a whitespace-free type import", 'import type{A}from"pkg";'],
    ["a type-only named import", 'import { type A } from "pkg";'],
    ["a type-only multi import", 'import { type A, type B } from "pkg";'],
    ["a type re-export", 'export type { A } from "pkg";'],
    ["a relative import", 'import x from "./local.js";'],
    ["a parent-relative import", 'import x from "../local.js";'],
    ["a node builtin", 'import { readFileSync } from "node:fs";'],
    ["a workers builtin", 'import { DurableObject } from "cloudflare:workers";'],
    ["a line comment", '// import x from "pkg";'],
    ["a block comment", '/* import x from "pkg"; */'],
    ["prose mentioning from and a string", '/* copied from the "pkg" docs */'],
    ["a plain string that resembles a specifier", 'const name = "pkg";'],
    // Statement forms still run over masked text, so import-shaped prose in a
    // string stays inert — only the two call forms over-report.
    ["an import statement quoted in a string", `const prose = 'import x from "pkg"';`],
    ["a specifier in an error message", 'throw new Error(`cannot load "pkg"`);'],
    ["an interpolated specifier, which cannot be resolved statically", "await import(`${base}pkg`);"],
  ])("ignores %s", (_label, source) => {
    expect(runtimeImports(source)).toEqual([]);
  });

  it("resolves a scoped package to its scope and name", () => {
    expect(runtimeImports('import x from "@scope/pkg/deep.js";')).toEqual(["@scope/pkg"]);
  });

  it("does not let a URL in a string swallow the rest of the line", () => {
    // The reason maskSource tracks strings while stripping comments: naively
    // cutting at `//` here would delete the import that follows.
    expect(runtimeImports('const u = "https://example.com"; import x from "pkg";')).toEqual([
      "pkg",
    ]);
  });

  it("does not run a match past the end of a statement", () => {
    expect(runtimeImports('import "pkg-a";\nconst from = "pkg-b";')).toEqual(["pkg-a"]);
  });

  it("collects every specifier in a file, not just the first", () => {
    const source = [
      'import { a } from "pkg-a";',
      'import type { B } from "pkg-b";',
      'export { c } from "pkg-c";',
      'const d = require("pkg-d");',
    ].join("\n");
    expect(runtimeImports(source).sort()).toEqual(["pkg-a", "pkg-c", "pkg-d"]);
  });

  it("terminates on an unterminated literal", () => {
    // Invalid source must not hang the sweep; under-reporting it is fine.
    expect(() => runtimeImports('import x from "pkg')).not.toThrow();
    expect(() => runtimeImports("const v = `${await import(")).not.toThrow();
  });

  it("scans pathological input without backtracking", () => {
    // The regression this guards: an earlier version matched the gaps between
    // call-form tokens with `(?:\\s|comment)*`, which took 86 seconds on this
    // input before failing. The scanner that replaced it is linear.
    const cases = [
      `import${" ".repeat(200_000)}("pkg");`,
      `import${"/* c */".repeat(20_000)}("pkg");`,
      `import${"/* c */".repeat(5_000)}("pkg"`,
    ];
    const started = Date.now();
    for (const source of cases) runtimeImports(source);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("still finds the import at the end of a long run of whitespace", () => {
    expect(runtimeImports(`import${" ".repeat(200_000)}("pkg");`)).toEqual(["pkg"]);
  });
});

describe("declared dependencies", () => {
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  const declared = new Set(Object.keys(pkg.dependencies ?? {}));

  const imported = new Map<string, string[]>();
  for (const file of sourceFiles(join(repoRoot, "src"))) {
    for (const name of runtimeImports(readFileSync(file, "utf8"))) {
      const relative = file.slice(repoRoot.length + 1);
      imported.set(name, [...(imported.get(name) ?? []), relative]);
    }
  }

  it("finds the packages src actually imports", () => {
    // Guards the sweep itself: a scan that matched nothing would make the
    // assertion below pass vacuously.
    expect([...imported.keys()].sort()).toEqual([
      "@modelcontextprotocol/sdk",
      "zod",
      "zod-to-json-schema",
    ]);
  });

  it("declares every package src imports at runtime", () => {
    const undeclared = [...imported.entries()]
      .filter(([name]) => !declared.has(name))
      .map(([name, files]) => `${name} (imported by ${files.join(", ")})`);

    expect(undeclared).toEqual([]);
  });
});
