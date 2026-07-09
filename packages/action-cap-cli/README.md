# @auron-labs/action-cap-cli

A TypeScript CLI for analyzing ActionCap extension exports (`.bxdac` session archive files) and extracting data useful for LLM agents.

## Overview

ActionCap users export sessions as `.bxdac` files (JSON with the `actioncap-session-archive` format). This CLI parses those archives and produces focused data views. Output defaults to pretty-printed JSON; [TOON](https://toonformat.dev) (Token-Oriented Object Notation) is available via `--format toon` for compact, LLM-friendly output.

## Install

```bash
bunx @auron-labs/action-cap-cli --help

# or install globally
bun install -g @auron-labs/action-cap-cli
actioncap --help

# From the package directory
cd packages/action-cap-cli
bun install

# Run directly with bun (no build needed)
bun run src/cli.ts --help

# Or build and use the binary
bun run build
./dist/cli.js --help
```

The npm package name is `@auron-labs/action-cap-cli`. It exposes the `actioncap` binary after installation.

## Quick usage

Every command takes a positional `<file>` argument (path to a `.bxdac` or `.json` archive).

Common entry points:

```bash
bun run src/cli.ts summary recording.bxdac
bun run src/cli.ts actions recording.bxdac
bun run src/cli.ts network recording.bxdac
bun run src/cli.ts network recording.bxdac --headers
bun run src/cli.ts errors recording.bxdac
bun run src/cli.ts endpoints recording.bxdac
bun run src/cli.ts forms recording.bxdac
bun run src/cli.ts navigation recording.bxdac
bun run src/cli.ts elements recording.bxdac
bun run src/cli.ts tabs recording.bxdac
bun run src/cli.ts replay recording.bxdac
bun run src/cli.ts dump recording.bxdac
bun run src/cli.ts network recording.bxdac --headers --format table
bun run src/cli.ts errors recording.bxdac --status ">=400"
bun run src/cli.ts dump recording.bxdac --no-replay
```

Available commands: `summary`, `actions`, `network`, `errors`, `endpoints`, `forms`, `navigation`, `elements`, `tabs`, `replay`, `dump`.

For the full command reference, flags, filtering examples, and output-format details, see [../../docs/cli.md](../../docs/cli.md).

## Common options

| Flag | Type | Default | Description |
|---|---|---|---|
| `--format` | `json` \| `table` \| `toon` | `json` | Output format. JSON is the default for readability. TOON produces compact, human-readable output for LLM context windows. |
| `--tab` | `number` | — | Filter to a specific tab ID. |
| `--type` | `string` | — | Filter by event type (comma-separated, e.g. `click,input`). |
| `--status` | `string` | — | Filter network by status (e.g. `4xx`, `5xx`, `200`, `>=400`). |
| `--from` | `number` | — | Start timestamp (ms since epoch). |
| `--to` | `number` | — | End timestamp (ms since epoch). |
| `--limit` | `number` | — | Max events to output. |
| `--verbose` | `boolean` | `false` | Verbose logging to stderr. |

Supported output formats are `json`, `table`, and `toon`. Use `toon` when you want a more compact, LLM-friendly representation.

## Development

```bash
bun install          # Install dependencies
bun run dev          # Run CLI directly from source
bun run build        # Compile TypeScript to dist/
bun run typecheck    # Type check without emitting
bun test             # Run test suite
```

For repository-wide development, packaging, and release checks, see [../../docs/development.md](../../docs/development.md).

## Data Model

The CLI works with `.bxdac` files exported by the ActionCap browser extension. Each archive contains:

| Table | What it represents |
|---|---|
| `session` | Top-level metadata: scope, duration, counts |
| `tabs` | Browser tabs tracked during recording |
| `userActions` | Clicks, inputs, key presses, scrolls, navigations |
| `networkEvents` | HTTP requests/responses via Chrome DevTools Protocol |
| `replayEvents` | rrweb DOM snapshots for session replay |

Sensitive values (passwords, tokens, auth, cookies) are masked by the extension before storage. The CLI preserves `masked` flags, but exported archives can still contain sensitive data and should be handled carefully.

## License

MIT
