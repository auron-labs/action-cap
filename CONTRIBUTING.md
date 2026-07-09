# Contributing to ActionCap

Thanks for your interest in contributing to ActionCap. This guide covers contribution workflow; use the development docs for setup, build, and package details.

## Repository structure

ActionCap has two independent packages:

| Package | Location | Package manager | Purpose |
|---|---|---|---|
| Extension | Repository root | Bun | Browser extension (MV3) |
| CLI | `packages/action-cap-cli/` | Bun | CLI for analyzing `.bxdac` archives |

The CLI is **not** a Bun workspace — it is a standalone package with its own `bun.lock`.

## Getting started

- Use [docs/development.md](docs/development.md) for repository setup, local development, testing, builds, and packaging.
- Use [packages/action-cap-cli/README.md](packages/action-cap-cli/README.md) or [docs/cli.md](docs/cli.md) for CLI command usage.
- Test extension changes in Chrome, Edge, or Firefox as appropriate for the feature.

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

No linter or formatter is configured. Match the surrounding style and the conventions documented in [docs/development.md](docs/development.md).

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

The CLI is published to npm as `@auron-labs/action-cap-cli` when its version changes. This depends on the repository release workflow and the `NPM_TOKEN` secret configured in GitHub Actions.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
