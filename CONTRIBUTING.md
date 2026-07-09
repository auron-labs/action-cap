# Contributing to ActionCap

Thanks for your interest in contributing to ActionCap! This guide covers the basics for getting set up.

## Prerequisites

- [Bun](https://bun.sh)
- Chrome, Edge, or Firefox for testing the extension

## Repository structure

ActionCap has two independent packages:

| Package | Location | Package manager | Purpose |
|---|---|---|---|
| Extension | Repository root | Bun | Browser extension (MV3) |
| CLI | `packages/action-cap-cli/` | Bun | CLI for analyzing `.bxdac` archives |

The CLI is **not** a Bun workspace — it is a standalone package with its own `bun.lock`.

## Setup

### Extension

```bash
bun install
bun run dev          # start Vite dev server
pitchfork start extension
```

### CLI

```bash
cd packages/action-cap-cli
bun install
bun run dev -- --help
```

## Development workflow

1. Create a branch from `main`.
2. Make your changes, keeping commits [conventional](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, `docs:`).
3. Run the relevant checks:

| Change | Command |
|---|---|
| Extension TypeScript | `bun run typecheck` |
| Extension payload-format | `bun run test` |
| Extension build | `bun run build` |
| CLI TypeScript | `cd packages/action-cap-cli && bun run typecheck` |
| CLI tests | `cd packages/action-cap-cli && bun test` |

4. Open a pull request against `main`.
5. Use squash-merge so the commit history stays clean for changelog generation.

## Code style

No linter or formatter is configured. Match the existing style:

- 2-space indentation
- Single quotes
- Named imports/exports
- PascalCase for React component files

## Localization

When adding or changing UI strings:

1. Add keys to both `en-US` and `zh-CN` in `src/common/i18n.ts`.
2. For manifest strings, update both `public/_locales/en/messages.json` and `public/_locales/zh_CN/messages.json`.

## Security

- Never weaken the sanitizer, masking, or permission logic in `src/common/sanitizer.ts`.
- Never commit real credentials, `.env` files, or exported session files.
- The extension handles sensitive data — see [SECURITY.md](SECURITY.md) for responsible disclosure.

## Releases

Releases are automated via [release-please](https://github.com/googleapis/release-please) driven by conventional commits. Merging a release PR creates a GitHub release and uploads extension store archives automatically.

The CLI is published to npm as `@auron-labs/action-cap-cli` when its version changes. This requires the `NPM_TOKEN` secret to be configured in repository settings.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
