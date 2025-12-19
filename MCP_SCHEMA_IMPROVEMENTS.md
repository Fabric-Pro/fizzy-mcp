# MCP Tool Schema Improvements

## Summary

Improved all Fizzy MCP tool schemas to follow the Model Context Protocol (MCP) specification standards, making them more understandable for AI clients and better integrated with MCP-compatible applications.

## Changes Made

### 1. **Enhanced Schema Descriptions** (`src/tools/schemas.ts`)

#### ID Schemas - Added Context and Discovery Guidance
- **Before**: Simple descriptions like "The board ID"
- **After**: Detailed descriptions with context and discovery hints:
  ```typescript
  "The unique board identifier (numeric string, e.g., '12345'). 
   Get available board IDs from fizzy_get_boards."
  ```

#### Property Descriptions - Added Behavioral Details
- **Before**: Basic field descriptions
- **After**: Comprehensive descriptions including:
  - Expected format and examples
  - Behavioral notes (e.g., HTML support, automatic tag creation)
  - Usage guidance and best practices
  - Warnings for destructive or replace-all operations

#### Filter Parameters - Clarified Logic
- **Before**: "Filter by assignee IDs"
- **After**: "Filter cards by assigned users. Provide an array of user IDs. 
             Only returns cards assigned to ANY of the specified users (OR logic). 
             Omit to include cards regardless of assignments."

#### Enum Values - Added Semantic Meaning
- **Column colors**: Now includes visual context (e.g., "yellow (attention)", "lime (success)")
- **Card statuses**: Now explains visibility implications (e.g., "draft = not yet visible to team")

### 2. **Created Centralized Tool Definitions** (`src/tools/definitions.ts`)

New comprehensive tool definitions file that follows MCP specification exactly:

#### Tool Metadata Structure
Each tool now includes:
- **name**: Unique identifier (validated per MCP spec: 1-128 chars, alphanumeric + _-.)
- **title**: Human-readable display name for UI
- **description**: Detailed, contextual functionality description
- **inputSchema**: JSON Schema (automatically generated from Zod)
- **annotations**: MCP behavioral hints

#### Annotations Added
Tools now include MCP-standard annotations:
- **readOnlyHint**: Indicates if tool modifies environment
  - `true` for all GET/LIST operations
  - `false` for CREATE/UPDATE/DELETE operations
  
- **destructiveHint**: Indicates if tool performs destructive updates
  - `true` for DELETE operations and major data modifications
  - `false` for additive updates and read operations

#### Organization by Category
Tools organized into logical groups:
- Identity (2 tools)
- Boards (5 tools)
- Cards (5 tools)
- Card Actions (9 tools)
- Comments (5 tools)
- Reactions (3 tools)
- Steps/To-dos (4 tools)
- Columns (5 tools)
- Tags (1 tool)
- Users (4 tools)
- Notifications (4 tools)

Total: **47 tools** with complete MCP metadata

#### Utility Functions
```typescript
// O(1) tool lookup by name
const tool = getToolDefinition("fizzy_get_boards");

// Iterate all tools
for (const tool of ALL_TOOLS) { ... }

// Access by category
const boardTools = TOOL_DEFINITIONS.boards;
```

## MCP Specification Compliance

### ✅ Fully Compliant With
1. **Tool Structure** (MCP Spec Section: Server Features > Tools)
   - Unique names (1-128 chars, case-sensitive, alphanumeric + _-.)
   - Human-readable titles for display
   - Detailed descriptions for AI understanding
   - JSON Schema inputSchema (defaults to 2020-12)

2. **Annotations** (MCP Spec: ToolAnnotations)
   - readOnlyHint for environment modification behavior
   - destructiveHint for data deletion/replacement operations
   - All hints properly marked as untrusted per security guidelines

3. **Schema Guidelines** (MCP Spec: JSON Schema Usage)
   - Comprehensive property descriptions
   - Explicit required fields
   - Proper type definitions
   - No custom extensions

4. **Error Prevention**
   - Detailed descriptions help LLMs understand tool usage
   - Examples prevent format errors (dates, IDs, HTML)
   - Warnings for destructive operations
   - Clear guidance on when to use each tool

## Benefits for AI Clients

### Better Tool Discovery
- **Titles** make tools easily scannable in UI
- **Categories** help organize large tool sets
- **Descriptions** provide context for when to use each tool

### Improved Parameter Understanding
- **Detailed descriptions** reduce parameter errors
- **Format examples** prevent validation failures
- **Behavioral notes** explain side effects
- **Discovery hints** show how to get required IDs

### Enhanced Decision Making
- **readOnlyHint** helps clients understand data safety
- **destructiveHint** enables confirmation prompts
- **Relationship info** guides tool call sequencing
- **Optional vs required** clarified for all parameters

### Error Reduction
- Clearer descriptions → fewer malformed requests
- Better examples → correct parameter formatting
- Explicit warnings → avoided destructive mistakes
- Discovery guidance → proper ID resolution

## Example Improvements

### Before (Generic)
```typescript
{
  name: "fizzy_create_card",
  description: "Create a new card on a board",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string" },
      description: { type: "string" },
      ...
    }
  }
}
```

### After (MCP-Compliant)
```typescript
{
  name: "fizzy_create_card",
  title: "Create Card",
  description: 
    "Create a new card on a board with optional title, description (HTML supported), " +
    "status (draft/published), column placement, assignees, tags, and due date. " +
    "Cards start in triage by default unless a column is specified.",
  inputSchema: {
    type: "object",
    properties: {
      title: { 
        type: "string",
        description: "The card title (required). Keep concise and descriptive. " +
                    "This is the main identifier shown in card lists and boards."
      },
      description: {
        type: "string",
        description: "Detailed card description. Supports HTML formatting including: " +
                    "<b>bold</b>, <i>italic</i>, <a href='...'>links</a>, <code>code</code>, " +
                    "<ul><li>lists</li></ul>, <pre>code blocks</pre>. " +
                    "Omit for cards that don't need detailed descriptions."
      },
      ...
    },
    required: ["account_slug", "board_id", "title"],
    additionalProperties: false
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false
  }
}
```

## Next Steps

To fully integrate these improvements:

1. **Update server.ts** - Use tool definitions for registration
2. **Update Cloudflare mcp-session.ts** - Use tool definitions instead of inline schemas
3. **Add tool icons** - Optional visual enhancements for UI
4. **Add output schemas** - Define expected response structures
5. **Add usage examples** - Show common tool call patterns

## References

- [MCP Specification: Tools](https://modelcontextprotocol.io/specification/draft/server/tools)
- [MCP JSON Schema Usage](https://modelcontextprotocol.io/specification/draft/basic#json-schema-usage)
- [MCP Tool Annotations](https://modelcontextprotocol.io/specification/draft/server/tools#tool)
- [MCP Security Best Practices](https://modelcontextprotocol.io/specification/draft/basic/security_best_practices)

## Testing Recommendations

1. Test tool discovery in MCP Inspector
2. Verify descriptions render correctly in Claude Desktop/Cursor
3. Validate that readOnly/destructive hints trigger appropriate UI behaviors
4. Check that improved descriptions reduce tool call errors
5. Monitor if better guidance improves first-call success rates
