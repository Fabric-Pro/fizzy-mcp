# CLAUDE.md

Instructions for AI coding agents working in this repository.

## Pull requests

- Do not mention Claude, Claude Code, or AI assistance anywhere in pull requests — no "Generated with Claude Code" footers, badges, or AI attribution in PR titles, bodies, or review comments.

## Test data and examples

Use synthetic values wherever examples appear: tests, fixtures, code comments, README and doc
examples, tool descriptions, and commit messages. This is a public repository, and tool
descriptions in particular compile into `dist/`, ship in the published package, and are
returned to every client in `tools/list`.

- The established placeholder account slug is `123456`. Reuse it rather than introducing new ones.
- Where behaviour is verified against a real account, keep the findings and drop the identifiers before committing. Account slugs, card numbers and titles, board and user IDs, `sgid` and Active Storage `signed_id` tokens, attachment filenames, and user names or email addresses all count.
- Fixtures should keep the *shape* of real payloads (attribute names and ordering, nested element structure, token charset and length) and fabricate the *values*. Structure is what the code must handle; values are what leak.
- Don't hardcode upstream hostnames. Base URLs are configurable, so assert on behaviour instead.
