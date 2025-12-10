# Publishing to npm

This document is for maintainers who need to publish new versions of the package.

## Prerequisites

1. You must be a collaborator on the npm package
2. Login to npm: `npm login`

## Publishing a New Version

```bash
# 1. Ensure you're on main branch with latest changes
git checkout main
git pull origin main

# 2. Ensure tests pass
npm test

# 3. Build the project
npm run build

# 4. Bump version (choose one based on changes)
npm version patch   # 1.0.0 → 1.0.1 (bug fixes)
npm version minor   # 1.0.0 → 1.1.0 (new features)
npm version major   # 1.0.0 → 2.0.0 (breaking changes)

# 5. Publish to npm
npm publish

# 6. Push changes and tags to GitHub
git push origin main --follow-tags
```

## First-time Setup

If you're setting up npm publishing for the first time:

1. Create an npm account at [npmjs.com](https://www.npmjs.com/signup)
2. Verify the package name is available: `npm search fizzy-mcp`
3. Login: `npm login`
4. Publish with public access: `npm publish --access public`

## Version Guidelines

- **patch** (1.0.x): Bug fixes, documentation updates, dependency updates
- **minor** (1.x.0): New features that are backwards compatible
- **major** (x.0.0): Breaking changes to the API or tool signatures

## Verifying Publication

After publishing, verify at: https://www.npmjs.com/package/fizzy-mcp

## Troubleshooting

### "You must be logged in to publish packages"
```bash
npm login
```

### "Package name already exists"
The package name `fizzy-mcp` must be unique on npm.

### "prepublishOnly script failed"
Tests must pass before publishing. Fix any failing tests first.

