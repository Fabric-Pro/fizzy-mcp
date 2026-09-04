@AGENTS.local.md
# AGENTS.md

## Project Overview

fizzy-mcp is an MCP (Model Context Protocol) server for the Fizzy project management tool. It exposes 40+ tools for managing boards, cards, columns, steps, comments, reactions, tags, and notifications.

## Tech Stack

- **Language:** TypeScript 5.7 (ES2022, ESM modules)
- **Runtime:** Node.js 18+ (standard), Cloudflare Workers (production)
- **MCP SDK:** @modelcontextprotocol/sdk
- **Validation:** Zod
- **Testing:** Vitest
- **Build:** tsc (compile), tsx (dev)

## Architecture

```
src/
├── index.ts              # CLI entry point, transport selection
├── server.ts             # MCP server setup, tool registration
├── client/
│   ├── fizzy-client.ts   # HTTP client with retry, ETag caching
│   └── types.ts          # API request/response interfaces
├── tools/
│   ├── definitions.ts    # Tool metadata (name, description, annotations)
│   ├── schemas.ts        # Zod input schemas
│   └── handlers.ts       # Tool execution logic
├── transports/
│   ├── stdio.ts          # IDE integrations (Cursor, VS Code)
│   ├── sse.ts            # Server-Sent Events (multi-user)
│   └── http.ts           # Streamable HTTP (multi-user)
├── utils/
│   ├── errors.ts         # Typed error classes (FizzyAPIError, etc.)
│   ├── logger.ts         # Structured stderr logging
│   ├── security.ts       # CORS, auth, localhost binding
│   ├── session-manager.ts
│   ├── etag-cache.ts
│   ├── card-resolver.ts  # card_id → card_number
│   ├── attachments.ts    # Upload input resolution + ActionText markup
│   ├── file-source.ts    # Injected local-file capability (stdio only)
│   ├── md5.ts            # Runtime-independent MD5 (upload checksums)
│   └── base64.ts         # btoa/atob helpers that also work on Workers
└── cloudflare/           # Workers deployment (Durable Objects)
```

### Key flow

1. `server.ts` registers tools from `tools/definitions.ts`
2. Each tool call dispatches through `executeToolHandler()` in `tools/handlers.ts`
3. Handlers call `FizzyClient` methods which make HTTP requests to the Fizzy API
4. Responses are formatted as MCP text content

### Tool system

Tools are defined across three files that must stay in sync:
- **`definitions.ts`** — tool name, title, description, schema reference, annotations
- **`schemas.ts`** — Zod schema for input validation (field names here are what MCP clients send)
- **`handlers.ts`** — flat `Record<toolName, handler>` mapping; maps MCP args to client method calls

When adding or modifying a tool, update all three files.

### Types

- Request types (`Create*Request`, `Update*Request`) in `types.ts` must match the Fizzy API field names exactly — these are serialized directly into the HTTP request body
- Response types (`Fizzy*`) must match the API's JSON response fields
- Zod schemas in `schemas.ts` define the MCP-facing field names

## Commands

```shell
npm test              # Unit tests (excludes integration/cloudflare)
npm run test:all      # All tests
npm run build         # TypeScript compile
npm run dev           # Dev server with tsx watch
npm run start:stdio   # stdio transport
npm run start:sse     # SSE transport (port 3000)
npm run start:http    # Streamable HTTP transport (port 3000)
```

## Environment Variables

- `FIZZY_ACCESS_TOKEN` — required for stdio transport
- `FIZZY_BASE_URL` — API base URL (default: `https://app.fizzy.do`)
- `MCP_TRANSPORT` — default transport (default: `stdio`)
- `MCP_ALLOWED_ORIGINS` — CORS origins (default: `*`); matched exactly, except that a portless loopback entry matches any port on the same scheme and hostname (`utils/origin.ts`)
- `MCP_AUTH_TOKEN` — optional client bearer token
- `LOG_LEVEL` — `debug`/`info`/`warn`/`error` (default: `info`)

## Code Conventions

- Type-only imports/exports must use `export type` / `import type` — tsx strips value exports of interfaces at runtime
- Logging goes to stderr (never stdout — it interferes with stdio transport)
- `FizzyClient` is passed into handlers via dependency injection, not imported as a global
- Security: localhost binding by default, origin validation, per-user token isolation for HTTP/SSE transports
- **Never import `node:fs` (or any filesystem API) into `client/`, `tools/` or `utils/`.** That code is shared with the Cloudflare Worker, which has no filesystem, and with the HTTP/SSE transports, which serve *remote* callers — reading a caller-supplied path there would let a client exfiltrate the server's disk. Local file access is a capability injected at startup via `utils/file-source.ts`, and only `startStdioTransport` in `index.ts` installs it. Leave the default (no reader) alone; it is what keeps every other transport closed
- Anything reached from `client/`, `tools/` or `utils/` must also run on Workers: no `Buffer`, no `node:crypto`, no reliance on the `nodejs_compat` flag. New files there must be added to `tsconfig.cloudflare.json`'s `include`, or CI's Cloudflare typecheck will not cover them
- Error classes in `utils/errors.ts` carry status codes and support retry detection

## Testing

Tests live in `/tests` mirroring the `src/` structure. Use `vitest` globals (no imports needed for `describe`/`it`/`expect`). Integration tests in `tests/integration/` hit the real API and are excluded from the default test run.
