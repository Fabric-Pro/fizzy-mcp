# Fizzy MCP Server

[![npm version](https://badge.fury.io/js/fizzy-mcp.svg)](https://www.npmjs.com/package/fizzy-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for [Fizzy](https://fizzy.do) — the project management tool by Basecamp.

> 🚀 **Try it live**: [https://fizzy.fabric.pro/mcp](https://fizzy.fabric.pro/mcp)

> 📖 **Fizzy API Documentation**: [github.com/basecamp/fizzy/blob/main/docs/API.md](https://github.com/basecamp/fizzy/blob/main/docs/API.md)

This MCP server allows AI assistants like Claude, Cursor, and GitHub Copilot to interact with your Fizzy boards, cards, and projects through natural language.

## Table of Contents

- [Features](#features)
- [Transport Support](#transport-support)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Installation](#installation)
- [Getting Your Fizzy Access Token](#getting-your-fizzy-access-token)
- [Configuration](#configuration)
  - [For Cursor IDE](#for-cursor-ide)
  - [For VS Code with GitHub Copilot](#for-vs-code-with-github-copilot)
  - [For Claude Desktop](#for-claude-desktop)
  - [For Other MCP-Compatible IDEs](#for-other-mcp-compatible-ides)
- [Running the Server](#running-the-server)
- [Environment Variables](#environment-variables)
- [Available Tools](#available-tools-47-total)
- [Example Prompts](#example-prompts)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [API Reference](#api-reference)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

## Features

- **Full Fizzy API Coverage**: 44 tools covering Boards, Cards, Card Actions, Comments, Reactions, Steps, Columns, Tags, Users, and Notifications
- **Multiple Transport Protocols**: Stdio (CLI/IDE), HTTP (Streamable), and SSE (deprecated)
- **Multi-User Support**: HTTP and SSE transports support multiple users with per-user authentication
- **Flexible Deployment**: Run locally (Node.js) or deploy globally (Cloudflare Workers)
- **IDE Integration**: Works with Cursor, VS Code, Claude Desktop, and other MCP-compatible tools
- **Robust Error Handling**: Structured error classes with detailed error messages
- **Automatic Retries**: Exponential backoff retry logic for transient failures (5xx errors, timeouts, network issues)
- **Request Timeout**: 30-second default timeout to prevent hanging requests
- **ETag Caching**: Automatic HTTP caching using ETags to reduce bandwidth and improve response times (as per [Fizzy API caching spec](https://github.com/basecamp/fizzy/blob/main/docs/API.md#caching))
- **Fully Tested**: Comprehensive test suite with 450+ test cases

## Transport Support

The Fizzy MCP server supports multiple transport protocols depending on your deployment environment:

### Transport Comparison

| Transport | Protocol Version | Node.js | Cloudflare | Use Case | Authentication |
|-----------|-----------------|---------|------------|----------|----------------|
| **stdio** | N/A | ✅ Yes | ❌ No | CLI/IDE integrations (Cursor, VS Code, Claude Desktop) | Single-user via `FIZZY_ACCESS_TOKEN` env var |
| **HTTP** (Streamable) | 2025-03-26 | ✅ Yes | ✅ Yes | **Production deployments, multi-user applications** | Multi-user via `Authorization: Bearer <token>` header |
| **SSE** | 2024-11-05 | ✅ Yes | ❌ No | ⚠️ **Deprecated** - backwards compatibility only | Multi-user via `Authorization: Bearer <token>` header |

### Deployment-Specific Support

#### **Node.js Deployment**
Supports all three transports:
- **stdio**: For single-user CLI/IDE integrations (recommended for local development)
- **HTTP (Streamable)**: For multi-user web applications and production deployments (recommended)
- **SSE**: Deprecated, maintained for backwards compatibility only

#### **Cloudflare Workers Deployment**
Supports HTTP transport only:
- **HTTP (Streamable)**: The only supported transport for Cloudflare Workers
- **Why no stdio?** Cloudflare Workers cannot spawn processes
- **Why no SSE?** SSE transport is deprecated and not supported on Cloudflare

### Recommendations

- **For IDE integrations** (Cursor, VS Code, Claude Desktop): Use **stdio** transport
- **For production deployments**: Use **HTTP (Streamable)** transport
- **For multi-user applications**: Use **HTTP (Streamable)** transport
- **For testing with MCP Inspector**: Use **HTTP (Streamable)** transport
- **Avoid SSE**: The SSE transport is deprecated and will be removed in a future version

### Authentication Models

#### **stdio Transport** (Single-User)
- Requires `FIZZY_ACCESS_TOKEN` environment variable
- One user per server instance
- Ideal for personal CLI/IDE use

#### **HTTP/SSE Transports** (Multi-User)
- Each user provides their own Fizzy Personal Access Token via `Authorization: Bearer <token>` header
- Multiple users can connect simultaneously
- Each session is isolated with its own FizzyClient instance
- Sessions timeout after 30 minutes of inactivity
- Optional server-level authentication via `MCP_AUTH_TOKEN` environment variable

## Prerequisites

- **Node.js 18** or higher
- A Fizzy account with API access

---

## Quick Start

Get up and running in 3 steps:

1. **Get your Fizzy access token** from [app.fizzy.do](https://app.fizzy.do) → Profile → API → Personal access tokens

2. **Run with npx** (no installation needed):
   ```bash
   FIZZY_ACCESS_TOKEN="your-token-here" npx fizzy-mcp
   ```

3. **Configure your IDE** (e.g., Cursor):
   - Open Cursor Settings → Features → MCP Servers
   - Click "Edit in mcp.json" and add:
   ```json
   {
     "mcpServers": {
       "fizzy": {
         "command": "npx",
         "args": ["-y", "fizzy-mcp"],
         "env": {
           "FIZZY_ACCESS_TOKEN": "your-token-here"
         }
       }
     }
   }
   ```
   - Restart Cursor

That's it! You can now ask your AI assistant to interact with Fizzy.

> 💡 **Note**: This Quick Start uses **stdio transport** for single-user IDE integration. For production deployments or multi-user applications, see the [HTTP Transport](#streamable-http-transport-for-production) section.

For detailed installation options and configuration, see the sections below.

---

## Installation

### Option 1: Install from npm (recommended)

```bash
npm install -g fizzy-mcp
```

The `fizzy-mcp` command will be available globally.

### Option 2: Use with npx (no installation required)

```bash
npx fizzy-mcp --help
```

### Option 3: Install from source

```bash
# Clone the repository
git clone https://github.com/Fabric-Pro/fizzy-mcp.git
cd fizzy-mcp

# Install dependencies
npm install

# Build the project
npm run build

# Link globally (makes `fizzy-mcp` command available)
npm link
```

To verify the installation:

```bash
fizzy-mcp --help
```

---

## Getting Your Fizzy Access Token

1. Log in to your [Fizzy account](https://app.fizzy.do)
2. Go to your **Profile** (click your avatar)
3. Navigate to the **API** section
4. Click on **Personal access tokens**
5. Click **Generate new access token**
6. Give it a description and select permissions:
   - **Read**: For read-only access
   - **Read + Write**: For full access (recommended)
7. Copy and save your token securely

> ⚠️ **Important**: Keep your access token secret! Anyone with your token can access your Fizzy account.

---

## Configuration

### For Cursor IDE

Cursor supports two connection methods: **stdio** (local process) and **HTTP** (remote server).

#### Option 1: Stdio Transport (Local Process - Recommended for Personal Use)

1. Open Cursor Settings (`Cmd/Ctrl + ,`)
2. Search for "MCP" or navigate to **Features > MCP Servers**
3. Click **Edit in mcp.json** or manually edit `~/.cursor/mcp.json`:

**Using npx (recommended):**

```json
{
  "mcpServers": {
    "fizzy": {
      "command": "npx",
      "args": ["-y", "fizzy-mcp"],
      "env": {
        "FIZZY_ACCESS_TOKEN": "your-fizzy-access-token-here"
      }
    }
  }
}
```

**If installed globally:**

```json
{
  "mcpServers": {
    "fizzy": {
      "command": "fizzy-mcp",
      "env": {
        "FIZZY_ACCESS_TOKEN": "your-fizzy-access-token-here"
      }
    }
  }
}
```

4. **Restart Cursor** for changes to take effect

#### Option 2: HTTP Transport (Remote Server - For Shared/Production Deployments)

Use this method to connect to a remote Fizzy MCP server (e.g., deployed on Cloudflare Workers or a shared Node.js server).

1. Open Cursor Settings and edit `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "fizzy": {
      "url": "https://fizzy.fabric.pro/mcp",
      "transport": "streamable-http",
      "headers": {
        "Authorization": "Bearer YOUR_FIZZY_PERSONAL_ACCESS_TOKEN"
      }
    }
  }
}
```

**For local HTTP server:**

```json
{
  "mcpServers": {
    "fizzy": {
      "url": "http://localhost:3000/mcp",
      "transport": "streamable-http",
      "headers": {
        "Authorization": "Bearer YOUR_FIZZY_PERSONAL_ACCESS_TOKEN"
      }
    }
  }
}
```

2. **Restart Cursor** for changes to take effect

> 💡 **Tip**: Use the live server at [https://fizzy.fabric.pro/mcp](https://fizzy.fabric.pro/mcp) to try Fizzy MCP without running your own server!

### For VS Code with GitHub Copilot

#### Option 1: Stdio Transport (Local Process)

Create or edit `.vscode/mcp.json` in your workspace (or global settings):

```json
{
  "mcpServers": {
    "fizzy": {
      "command": "npx",
      "args": ["-y", "fizzy-mcp"],
      "env": {
        "FIZZY_ACCESS_TOKEN": "your-fizzy-access-token-here"
      }
    }
  }
}
```

#### Option 2: HTTP Transport (Remote Server)

```json
{
  "mcpServers": {
    "fizzy": {
      "url": "https://fizzy.fabric.pro/mcp",
      "transport": "streamable-http",
      "headers": {
        "Authorization": "Bearer YOUR_FIZZY_PERSONAL_ACCESS_TOKEN"
      }
    }
  }
}
```

### For Claude Desktop

Claude Desktop supports stdio transport only.

Edit your Claude Desktop configuration file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "fizzy": {
      "command": "npx",
      "args": ["-y", "fizzy-mcp"],
      "env": {
        "FIZZY_ACCESS_TOKEN": "your-fizzy-access-token-here"
      }
    }
  }
}
```

### For Other MCP-Compatible IDEs

Most MCP-compatible IDEs support HTTP transport. Use this configuration pattern:

```json
{
  "mcpServers": {
    "fizzy": {
      "url": "https://fizzy.fabric.pro/mcp",
      "transport": "streamable-http",
      "headers": {
        "Authorization": "Bearer YOUR_FIZZY_PERSONAL_ACCESS_TOKEN"
      }
    }
  }
}
```

Replace `https://fizzy.fabric.pro/mcp` with your own server URL if you're self-hosting.

---

## Running the Server

### Stdio Transport (default - for IDE integration)

```bash
# Using npx
FIZZY_ACCESS_TOKEN="your-token" npx fizzy-mcp

# If installed globally
FIZZY_ACCESS_TOKEN="your-token" fizzy-mcp
```

### SSE Transport (for web clients)

```bash
# Start the server (no FIZZY_ACCESS_TOKEN needed - users provide their own)
npx fizzy-mcp --transport sse --port 3000

# Endpoints:
#   SSE: http://localhost:3000/sse
#   Messages: http://localhost:3000/messages
```

**Connecting clients:**
```bash
# Each user provides their own Fizzy token via Authorization header
curl -H "Authorization: Bearer YOUR_FIZZY_TOKEN" \
     http://localhost:3000/sse
```

### Streamable HTTP Transport (for production)

```bash
# Start the server (no FIZZY_ACCESS_TOKEN needed - users provide their own)
npx fizzy-mcp --transport http --port 3000

# Endpoints:
#   MCP: http://localhost:3000/mcp
#   Health: http://localhost:3000/health
```

**Connecting clients:**
```bash
# Each user provides their own Fizzy token via Authorization header
curl -X POST \
     -H "Authorization: Bearer YOUR_FIZZY_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
     http://localhost:3000/mcp
```

### Cloudflare Workers (for edge deployment)

Deploy to Cloudflare Workers for global distribution with near-zero cold starts:

```bash
# Install dependencies
npm install

# Login to Cloudflare
npx wrangler login

# Deploy
npm run cf:deploy
```

**Important Notes:**
- Cloudflare Workers **only supports HTTP transport** (no stdio or SSE)
- **Multi-user authentication**: Each user provides their own Fizzy token via `Authorization: Bearer <token>` header
- **No FIZZY_ACCESS_TOKEN needed**: Unlike stdio transport, Cloudflare deployment uses per-user tokens
- **Durable Objects**: Sessions are managed using Cloudflare Durable Objects for persistence

See the [Cloudflare Deployment Guide](docs/CLOUDFLARE.md) for detailed instructions.

---

## Environment Variables

### Core Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `FIZZY_ACCESS_TOKEN` | **stdio only** | — | Your Fizzy API access token (**required for stdio transport only**). HTTP/SSE users provide tokens via Authorization header. |
| `FIZZY_BASE_URL` | No | `https://app.fizzy.do` | Fizzy API base URL |
| `PORT` | No | `3000` | Port for HTTP/SSE transport |
| `MCP_TRANSPORT` | No | `stdio` | Default transport (stdio, sse, http) |
| `LOG_LEVEL` | No | `info` | Logging level (debug, info, warn, error) |

### HTTP/SSE Transport Security

When using HTTP or SSE transports, additional security options are available:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MCP_ALLOWED_ORIGINS` | No | `*` | Allowed CORS origins (comma-separated or `*` for all) |
| `MCP_AUTH_TOKEN` | No | — | Optional bearer token for Client Authentication (authenticates MCP clients connecting to this server) |
| `MCP_BIND_ALL_INTERFACES` | No | `false` | Set to `true` to bind to 0.0.0.0 instead of localhost |

**Multi-User Support:**

SSE and HTTP transports support multiple users simultaneously:
- Each user provides their own Fizzy Personal Access Token via `Authorization: Bearer <token>` header
- Each session is isolated with its own FizzyClient instance
- Users cannot access each other's data
- Sessions timeout after 30 minutes of inactivity

**Security Model:**
- **Localhost binding** (default): Server binds to `127.0.0.1`, preventing remote access
- **CORS origins**: Controls which web origins can connect (default: all)
- **User Authentication**: Each user provides their own Fizzy token via Authorization header
- **Client Authentication**: Optional bearer token to authenticate MCP clients connecting to this server

```bash
# Basic usage (binds to localhost, allows all CORS origins)
# Users provide their own tokens via Authorization header
npx fizzy-mcp --transport http --port 3000

# Restrict CORS to specific origins
MCP_ALLOWED_ORIGINS="http://localhost:3000,https://myapp.com" \
npx fizzy-mcp --transport http --port 3000

# Enable Client Authentication (require MCP clients to provide a bearer token)
MCP_AUTH_TOKEN="my-secret-token" \
npx fizzy-mcp --transport http --port 3000

# For Docker/remote access (use with restricted origins and client auth)
MCP_BIND_ALL_INTERFACES=true \
MCP_ALLOWED_ORIGINS="https://myapp.com" \
MCP_AUTH_TOKEN="my-secret-token" \
npx fizzy-mcp --transport http --port 3000
```

> ⚠️ **Authentication Types:**
> - **User Authentication** (via `Authorization` header): Required for SSE/HTTP transports. Each user provides their own Fizzy Personal Access Token.
> - **Client Authentication** (`MCP_AUTH_TOKEN`): Optional. Authenticates MCP clients (like IDE extensions) connecting to this server.
>
> **Note:** For stdio transport, use `FIZZY_ACCESS_TOKEN` environment variable (single-user mode for CLI/IDE integrations).

---

## Available Tools (47 total)

### Identity & Accounts (3)
| Tool | Description |
|------|-------------|
| `fizzy_get_identity` | Get current user's identity and accounts |
| `fizzy_get_accounts` | List all accessible accounts |
| `fizzy_get_account` | Get details of a specific account |

### Boards (5)
| Tool | Description |
|------|-------------|
| `fizzy_get_boards` | List all boards in an account |
| `fizzy_get_board` | Get details of a specific board |
| `fizzy_create_board` | Create a new board |
| `fizzy_update_board` | Update a board's name |
| `fizzy_delete_board` | Delete a board |

### Cards (6)
| Tool | Description |
|------|-------------|
| `fizzy_get_cards` | List cards with optional filters (status, column, assignees, tags, search) |
| `fizzy_get_board_cards` | List cards on a specific board |
| `fizzy_get_card` | Get card details including description, assignees, tags |
| `fizzy_create_card` | Create a new card with title, description, status, column, assignees, tags, due date |
| `fizzy_update_card` | Update any card property |
| `fizzy_delete_card` | Delete a card |

### Card Actions (9)
| Tool | Description |
|------|-------------|
| `fizzy_close_card` | Close a card (mark as done) |
| `fizzy_reopen_card` | Reopen a closed card |
| `fizzy_move_card_to_not_now` | Move a card to "Not Now" triage |
| `fizzy_move_card_to_column` | Move a card from triage to a specific column |
| `fizzy_send_card_to_triage` | Send a card back to triage (remove from column) |
| `fizzy_toggle_card_tag` | Toggle a tag on/off for a card |
| `fizzy_toggle_card_assignment` | Toggle a user assignment on/off for a card |
| `fizzy_watch_card` | Subscribe to notifications for a card |
| `fizzy_unwatch_card` | Unsubscribe from notifications for a card |

### Comments (5)
| Tool | Description |
|------|-------------|
| `fizzy_get_card_comments` | List comments on a card |
| `fizzy_get_comment` | Get a specific comment |
| `fizzy_create_comment` | Add a comment to a card (supports HTML) |
| `fizzy_update_comment` | Update a comment |
| `fizzy_delete_comment` | Delete a comment |

### Reactions (3)
| Tool | Description |
|------|-------------|
| `fizzy_get_reactions` | Get all emoji reactions on a comment |
| `fizzy_add_reaction` | Add an emoji reaction to a comment |
| `fizzy_remove_reaction` | Remove an emoji reaction from a comment |

### Steps / To-dos (4)
| Tool | Description |
|------|-------------|
| `fizzy_get_step` | Get a specific to-do step on a card |
| `fizzy_create_step` | Create a new to-do step on a card |
| `fizzy_update_step` | Update a step (description or completion status) |
| `fizzy_delete_step` | Delete a step from a card |

### Columns (5)
| Tool | Description |
|------|-------------|
| `fizzy_get_columns` | List columns on a board |
| `fizzy_get_column` | Get column details |
| `fizzy_create_column` | Create a new column with name and color |
| `fizzy_update_column` | Update column name/color |
| `fizzy_delete_column` | Delete a column |

### Tags (1)
| Tool | Description |
|------|-------------|
| `fizzy_get_tags` | List all tags in an account |

### Users (4)
| Tool | Description |
|------|-------------|
| `fizzy_get_users` | List users in an account |
| `fizzy_get_user` | Get user details |
| `fizzy_update_user` | Update user's display name |
| `fizzy_deactivate_user` | Deactivate a user |

### Notifications (4)
| Tool | Description |
|------|-------------|
| `fizzy_get_notifications` | List notifications for current user |
| `fizzy_mark_notification_read` | Mark notification as read |
| `fizzy_mark_notification_unread` | Mark notification as unread |
| `fizzy_mark_all_notifications_read` | Mark all notifications as read |

---

## Example Prompts

Once configured, you can ask your AI assistant things like:

- "Show me all my Fizzy boards"
- "What cards are on my Engineering board?"
- "Create a new card called 'Fix login bug' on the Engineering board"
- "What cards are assigned to me?"
- "Move the 'Design review' card to the 'Done' column"
- "Add a comment to the authentication card saying 'Ready for review'"
- "Show me my unread notifications"
- "List all users in my account"
- "Create a new column called 'In Review' with blue color on the Engineering board"

---

## Troubleshooting

### "FIZZY_ACCESS_TOKEN environment variable is required"
Make sure you've set your access token in the MCP configuration's `env` section.

### "fizzy-mcp: command not found"
- Use `npx fizzy-mcp` instead of `fizzy-mcp`
- Or install globally: `npm install -g fizzy-mcp`

### Server not appearing in Cursor/VS Code
1. Restart the IDE after configuration changes
2. Check the path to the executable is correct
3. Verify Node.js is installed: `node --version`
4. Check Cursor's MCP logs for errors

### "Fizzy API error: 404 Not Found"
- Verify your access token is valid
- Check that you're using the correct account slug
- Ensure you have permission to access the resource

### Connection issues
Test your token directly:
```bash
curl -H "Authorization: Bearer your-token" \
     -H "Accept: application/json" \
     https://app.fizzy.do/my/identity.json
```

---

## FAQ

### How do I get started quickly?
See the [Quick Start](#quick-start) section above for a 3-step setup guide.

### Is my Fizzy access token secure?
Your access token is stored in your local IDE configuration and is never sent anywhere except directly to Fizzy's API. When using HTTP/SSE transports, the token is used server-side only. Always keep your token secret and never commit it to version control.

### Can I use this with multiple Fizzy accounts?
Yes! You can configure multiple MCP server instances in your IDE, each with a different access token. Just give them different names in the configuration (e.g., "fizzy-personal", "fizzy-work").

### What's the difference between the transport modes?
- **stdio** (default): For single-user IDE integration (Cursor, VS Code, Claude Desktop). Communication happens via standard input/output. Requires `FIZZY_ACCESS_TOKEN` environment variable.
- **http** (Streamable HTTP): **Recommended for production**. Multi-user support with per-user authentication via Authorization headers. Runs an HTTP server with streamable endpoints and health checks. Supported on both Node.js and Cloudflare Workers.
- **sse** (Server-Sent Events): **⚠️ Deprecated** - maintained for backwards compatibility only. Multi-user support but uses older protocol version (2024-11-05). Only supported on Node.js. Use HTTP transport instead.

### Which transport should I use?
- **For IDE integrations** (Cursor, VS Code, Claude Desktop): Use **stdio**
- **For production deployments**: Use **HTTP (Streamable)**
- **For multi-user applications**: Use **HTTP (Streamable)**
- **For testing with MCP Inspector**: Use **HTTP (Streamable)**
- **For Cloudflare Workers deployment**: Use **HTTP (Streamable)** (only option)

### How do I test with MCP Inspector?
[MCP Inspector](https://github.com/modelcontextprotocol/inspector) is a tool for testing MCP servers. Here's how to use it with Fizzy MCP:

**1. Start the HTTP server:**
```bash
npm run build
npm run start:http
# Server runs on http://localhost:3000
```

**2. Launch MCP Inspector:**
```bash
npx @modelcontextprotocol/inspector
```

**3. Configure the connection:**
- **Transport**: Select "HTTP"
- **URL**: `http://localhost:3000/mcp`
- **Headers**: Add `Authorization: Bearer YOUR_FIZZY_TOKEN`

**4. Test the connection:**
- Click "Connect"
- You should see the list of 47 available tools
- Try calling tools like `fizzy_get_identity` or `fizzy_get_boards`

**Note**: MCP Inspector does not support the deprecated SSE transport. Always use HTTP transport for testing.

### Does this work offline?
No, the server requires an internet connection to communicate with Fizzy's API at `app.fizzy.do`.

### How do I update to the latest version?
If using npx, it will automatically use the latest version. If installed globally, run `npm update -g fizzy-mcp`. If installed from source, run `git pull && npm install && npm run build`.

### Can I create tags via the API?
No, tag creation is not available via the Fizzy API. However, you can use `fizzy_toggle_card_tag` which will create a tag if it doesn't exist when toggling it on a card.

### What happens if I hit rate limits?
The server includes automatic retry logic with exponential backoff for rate limit errors (429 status). It will retry up to 3 times before failing.

### How does ETag caching work?
The server automatically caches GET requests using ETags. When you request the same resource again, it sends the ETag to Fizzy's API. If the resource hasn't changed, Fizzy returns a 304 Not Modified response, saving bandwidth and improving speed.

### Can I use this in production?
Yes! You have two options:
1. **Self-hosted**: Use the HTTP transport mode with proper security settings (`MCP_AUTH_TOKEN`, `MCP_ALLOWED_ORIGINS`, and consider `MCP_BIND_ALL_INTERFACES` for Docker deployments).
2. **Cloudflare Workers**: Deploy to the edge for global distribution, automatic scaling, and near-zero cold starts. See the [Cloudflare Deployment Guide](docs/CLOUDFLARE.md).

### Where can I find the Fizzy API documentation?
Official Fizzy API docs: [github.com/basecamp/fizzy/blob/main/docs/API.md](https://github.com/basecamp/fizzy/blob/main/docs/API.md)

---

## API Reference

This server implements all endpoints from the official [Fizzy API Documentation](https://github.com/basecamp/fizzy/blob/main/docs/API.md):

| Category | Endpoints Covered |
|----------|-------------------|
| Identity | GET /my/identity |
| Accounts | Embedded in identity |
| Boards | GET, POST, PUT, DELETE |
| Cards | GET (list, board, single), POST, PUT, DELETE + filtering |
| Comments | GET, POST, DELETE |
| Columns | GET (list, single), POST, PUT, DELETE |
| Tags | GET (account, board), POST, DELETE |
| Users | GET (list, single), PUT, DELETE |
| Notifications | GET, POST reading, DELETE reading, POST bulk_reading |

---

## Development

For contributors and developers:

```bash
# Clone the repository
git clone https://github.com/Fabric-Pro/fizzy-mcp.git
cd fizzy-mcp

# Install dependencies
npm install

# Run in development mode with hot reload
npm run dev

# Build for production
npm run build

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Type checking
npm run typecheck
```

---

## License

MIT

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass: `npm test`
5. Submit a pull request

## Author

Created by [Preetham Reddy](https://github.com/preddy4690)
