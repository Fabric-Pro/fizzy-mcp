# Deploying Fizzy MCP to Cloudflare Workers

This guide explains how to deploy the Fizzy MCP server to [Cloudflare Workers](https://developers.cloudflare.com/workers/) for a scalable, globally-distributed deployment.

## Table of Contents

- [Overview](#overview)
- [Transport Support](#transport-support)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Connecting Clients](#connecting-clients)
- [Security](#security)
- [Scaling](#scaling)
- [Monitoring](#monitoring)
- [Troubleshooting](#troubleshooting)

## Overview

The Cloudflare Workers deployment provides:

- **🌍 Global Distribution**: Runs on Cloudflare's edge network in 300+ cities
- **⚡ Near-Zero Cold Starts**: V8 isolates start in milliseconds
- **📈 Automatic Scaling**: Handles traffic spikes without configuration
- **🔄 Stateful Sessions**: Uses Durable Objects for session persistence
- **🔒 Built-in Security**: CORS, per-user authentication, TLS
- **👥 Multi-User Support**: Each user provides their own Fizzy token

## Transport Support

**Cloudflare Workers only supports HTTP (Streamable) transport.**

| Transport | Supported | Reason |
|-----------|-----------|--------|
| **HTTP (Streamable)** | ✅ Yes | Current standard (protocol version 2025-03-26) |
| **stdio** | ❌ No | Cloudflare Workers cannot spawn processes |
| **SSE** | ❌ No | Deprecated transport (protocol version 2024-11-05) |

### Authentication Model

Unlike the Node.js stdio transport which uses a single `FIZZY_ACCESS_TOKEN` environment variable, Cloudflare Workers uses **per-user authentication**:

- **No FIZZY_ACCESS_TOKEN needed**: The server does not require a shared access token
- **Per-user tokens**: Each user provides their own Fizzy Personal Access Token via `Authorization: Bearer <token>` header
- **Session isolation**: Each session gets its own FizzyClient instance with the user's token
- **Multi-user support**: Multiple users can connect simultaneously with complete data isolation

### Architecture

```
┌─────────────────┐      HTTPS       ┌──────────────────────────────┐
│   MCP Client    │ ◄──────────────► │    Cloudflare Worker         │
│ (Cursor, etc.)  │   Streamable     │  ┌────────────────────────┐  │
└─────────────────┘      HTTP        │  │   Durable Object       │  │
                                     │  │   (MCP Session)        │  │
                                     │  │  ┌──────────────────┐  │  │
                                     │  │  │ McpServer        │  │  │
                                     │  │  │ (47 Fizzy tools) │  │  │
                                     │  │  └──────────────────┘  │  │
                                     │  └────────────────────────┘  │
                                     └──────────────────────────────┘
                                                    │
                                                    │ HTTPS
                                                    ▼
                                     ┌──────────────────────────────┐
                                     │       Fizzy API              │
                                     │   https://app.fizzy.do       │
                                     └──────────────────────────────┘
```

## Prerequisites

1. **Cloudflare Account**: Sign up at [cloudflare.com](https://cloudflare.com)
2. **Wrangler CLI**: Installed via npm (included in dev dependencies)
3. **Node.js 18+**: For development and deployment

**Note**: Unlike Node.js stdio deployment, you do **not** need to configure a `FIZZY_ACCESS_TOKEN` environment variable. Each user will provide their own Fizzy Personal Access Token when connecting to the deployed Worker.

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Login to Cloudflare

```bash
npx wrangler login
```

### 3. Deploy

```bash
npm run cf:deploy
```

### 4. Get Your Worker URL

After deployment, you'll see output like:
```
Published fizzy-mcp (1.23 sec)
  https://fizzy-mcp.<your-subdomain>.workers.dev
```

### 5. Configure Your MCP Client

Each client needs to send their Fizzy token in the `Authorization` header.
See [Connecting Clients](#connecting-clients) for details.

## Configuration

### API Endpoints

The Worker exposes the following endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check endpoint (returns server status) |
| `/mcp` | POST | MCP protocol endpoint (HTTP Streamable transport) |
| `/mcp` | DELETE | Close MCP session |

**Note**: The `/sse` endpoint is not available on Cloudflare Workers. SSE transport is deprecated and only supported on Node.js deployments.

### Environment Variables

Configure in `wrangler.jsonc`:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `FIZZY_BASE_URL` | No | `https://app.fizzy.do` | Fizzy API base URL |
| `MCP_ALLOWED_ORIGINS` | No | `*` | Allowed CORS origins (comma-separated) |
| `LOG_LEVEL` | No | `info` | Logging level (debug, info, warn, error) |

### Authentication Model (Multi-User)

**The server does NOT store any Fizzy tokens.** Each client provides their own token:

```
Client (Cursor) ──── Authorization: Bearer <fizzy-token> ────► Cloudflare Worker ────► Fizzy API
```

This enables:
- **Multi-tenant deployments**: Each user has their own Fizzy account
- **No secrets on server**: Simpler deployment, better security
- **Per-request authentication**: Token is validated on each call

### Environments

The configuration supports multiple environments:

```bash
# Deploy to staging
npm run cf:deploy:staging

# Deploy to production
npm run cf:deploy:production
```

## Deployment

### Development

Run locally with Wrangler:

```bash
npm run cf:dev
```

This starts a local server at `http://localhost:8787` with hot reloading.

### Production

Deploy to Cloudflare's edge:

```bash
npm run cf:deploy
```

### Custom Domain

1. Add a custom domain in Cloudflare Dashboard → Workers → Routes
2. Configure DNS to point to your Worker

Example:
```
fizzy-mcp.yourdomain.com → fizzy-mcp.workers.dev
```

## Connecting Clients

**Cloudflare Workers only supports HTTP (Streamable) transport.**

All clients must:
1. Use the `/mcp` endpoint
2. Provide their Fizzy Personal Access Token via `Authorization: Bearer <token>` header
3. Use HTTP (Streamable) transport

### Cursor IDE

Edit `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "fizzy": {
      "url": "https://fizzy-mcp.<your-subdomain>.workers.dev/mcp",
      "transport": "streamable-http",
      "headers": {
        "Authorization": "Bearer YOUR_FIZZY_PERSONAL_ACCESS_TOKEN"
      }
    }
  }
}
```

> **Important**: Replace `YOUR_FIZZY_PERSONAL_ACCESS_TOKEN` with your actual Fizzy token from [app.fizzy.do](https://app.fizzy.do) → Profile → API → Personal access tokens.

### Claude Desktop

Edit your Claude Desktop config:

```json
{
  "mcpServers": {
    "fizzy": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://fizzy-mcp.<your-subdomain>.workers.dev/mcp",
        "--header",
        "Authorization: Bearer YOUR_FIZZY_PERSONAL_ACCESS_TOKEN"
      ]
    }
  }
}
```

### Testing with MCP Inspector

[MCP Inspector](https://github.com/modelcontextprotocol/inspector) is a tool for testing MCP servers. Here's how to test your Cloudflare deployment:

**1. Start local development server:**
```bash
npm run cf:dev
# Server runs on http://localhost:8787
```

**2. Launch MCP Inspector:**
```bash
npx @modelcontextprotocol/inspector
```

**3. Configure the connection:**
- **Transport**: Select "HTTP"
- **URL**: `http://localhost:8787/mcp` (local) or `https://fizzy-mcp.<your-subdomain>.workers.dev/mcp` (production)
- **Headers**: Click "Add Header" and add:
  - **Key**: `Authorization`
  - **Value**: `Bearer YOUR_FIZZY_PERSONAL_ACCESS_TOKEN`

**4. Test the connection:**
- Click **Connect**
- You should see the list of 47 available tools
- Try calling tools like `fizzy_get_identity` or `fizzy_get_boards`

**Note**: MCP Inspector only supports HTTP transport. SSE transport is not available on Cloudflare Workers.

## Security

### Authentication

**Multi-User Model**: The server does NOT store any Fizzy tokens. Each client provides their own:

```
Authorization: Bearer <fizzy-personal-access-token>
```

**Two-Layer Authentication System:**

1. **User Authentication** (via `Authorization` header):
   - **Required** for all API operations
   - Each user provides their own Fizzy Personal Access Token
   - Token is used to create a per-user FizzyClient instance
   - Authenticates requests to Fizzy API
   - Provides complete session isolation between users

2. **Client Authentication** (`MCP_AUTH_TOKEN`):
   - **Optional** but recommended for public deployments
   - Requires MCP clients (like IDE extensions) to provide a server-level bearer token
   - Prevents unauthorized MCP clients from connecting to your server
   - Independent of user authentication

### CORS Configuration

Restrict which origins can connect:

```jsonc
// In wrangler.jsonc
"vars": {
  "MCP_ALLOWED_ORIGINS": "https://cursor.sh,https://claude.ai"
}
```

### Security Headers

The deployment automatically includes security headers on all responses:

- **X-Content-Type-Options**: `nosniff` - Prevents MIME type sniffing
- **X-Frame-Options**: `DENY` - Prevents clickjacking attacks
- **X-XSS-Protection**: `1; mode=block` - Enables XSS filtering
- **Referrer-Policy**: `strict-origin-when-cross-origin` - Controls referrer information
- **Access-Control-Max-Age**: `86400` - Caches CORS preflight for 24 hours

### Best Practices

1. **Always set `MCP_AUTH_TOKEN`** for public deployments
2. **Restrict `MCP_ALLOWED_ORIGINS`** to known clients
3. **Use read-only Fizzy tokens** if write access isn't needed
4. **Monitor access logs** via Cloudflare Dashboard
5. **Use HTTPS only** - Never connect over plain HTTP

## Scaling

### Durable Objects

Each MCP session gets its own Durable Object instance:

- **Session Isolation**: Each client gets dedicated state
- **Automatic Scaling**: Cloudflare manages instance distribution
- **Persistence**: State survives across requests
- **Global Routing**: Requests route to nearest location

### Session Lifecycle

- Sessions timeout after **30 minutes** of inactivity
- Cleanup runs via Durable Object alarms every **15 minutes**
- DELETE `/mcp` explicitly closes a session

**Cost Optimization**: The alarm interval is set to 15 minutes to reduce Cloudflare Durable Objects alarm invocation costs. Alarms are billed per invocation, so a longer interval reduces costs while still providing reasonable cleanup latency.

### Limits

| Resource | Limit |
|----------|-------|
| Request size | 100 MB |
| Response size | 100 MB |
| CPU time per request | 30s (Durable Objects) |
| Memory per isolate | 128 MB |
| Concurrent connections | Unlimited |

## Monitoring

### Real-time Logs

```bash
npm run cf:tail
```

### Cloudflare Dashboard

- **Workers Analytics**: Request volume, latency, errors
- **Durable Objects**: Active instances, storage usage
- **Logs**: Real-time and historical log viewing

### Health Check

```bash
curl https://fizzy-mcp.<your-subdomain>.workers.dev/health
```

Response:
```json
{
  "status": "ok",
  "transport": "streamable-http",
  "version": "1.0.0",
  "durableObjects": true
}
```

## Troubleshooting

### "Authorization required" or "Missing Fizzy token"

**Cause**: User didn't provide their Fizzy Personal Access Token in the Authorization header.

**Solution**: Each user must provide their own Fizzy token:
```json
{
  "headers": {
    "Authorization": "Bearer YOUR_FIZZY_PERSONAL_ACCESS_TOKEN"
  }
}
```

Get your token from [app.fizzy.do](https://app.fizzy.do) → Profile → API → Personal access tokens.

### "Client authentication required"

**Cause**: Server has `MCP_AUTH_TOKEN` configured but client didn't provide it.

**Solution**: This is different from user authentication. If the server requires client authentication, contact the server administrator for the MCP auth token.

### "Origin not allowed"

**Cause**: CORS policy blocks your origin.

**Solution**: Update `MCP_ALLOWED_ORIGINS` in `wrangler.jsonc`:
```jsonc
"vars": {
  "MCP_ALLOWED_ORIGINS": "https://your-app.com,https://another-app.com"
}
```

Or set to `*` for development (not recommended for production):
```jsonc
"vars": {
  "MCP_ALLOWED_ORIGINS": "*"
}
```

### Session Errors

If you see session-related errors:
1. Check that `mcp-session-id` header is being sent
2. Verify the session hasn't timed out (30 min idle)
3. Try creating a new session (POST without session ID)

### Durable Object Errors

1. Ensure migrations are applied:
   ```bash
   npx wrangler deploy
   ```

2. Check Durable Object bindings in `wrangler.jsonc`

### Debugging

Enable debug logging:
```jsonc
// In wrangler.jsonc
"vars": {
  "LOG_LEVEL": "debug"
}
```

Then tail logs:
```bash
npm run cf:tail
```

## Comparison: Workers vs Node.js

| Feature | Cloudflare Workers | Node.js Server |
|---------|-------------------|----------------|
| Deployment | Edge (global) | Single server |
| Cold starts | ~0ms | N/A (always running) |
| Scaling | Automatic | Manual |
| Sessions | Durable Objects | In-memory |
| Cost | Pay-per-request | Fixed server cost |
| SSL | Automatic | Manual/Let's Encrypt |

## Cost Estimation

Cloudflare Workers pricing (as of 2024):

- **Free tier**: 100,000 requests/day
- **Paid**: $5/month + $0.50/million requests
- **Durable Objects**: $0.15/million requests + $0.20/GB-month storage

For typical MCP usage (few hundred requests/day), the free tier is sufficient.

## Next Steps

- [Vercel Deployment](./VERCEL.md) - Alternative serverless deployment
- [Security Best Practices](./SECURITY.md) - Hardening guide
- [API Reference](../README.md#api-reference) - Full tool documentation

