# action-cap-cli

A TypeScript CLI for analyzing ActionCap extension exports (`.bxdac` session archive files) and extracting data useful for LLM agents.

## Overview

ActionCap is a browser extension that records browser activity into IndexedDB. Users export sessions as `.bxdac` files (JSON with the `actioncap-session-archive` format). This CLI parses those archives and produces focused data views. Output defaults to pretty-printed JSON; [TOON](https://toonformat.dev) (Token-Oriented Object Notation) is available via `--format toon` for compact, LLM-friendly output.

## Install

```bash
# From the package directory
cd packages/action-cap-cli
bun install

# Run directly with bun (no build needed)
bun run src/cli.ts --help

# Or build and use the binary
bun run build
./dist/cli.js --help
```

## Commands

Every command takes a positional `<file>` argument (path to a `.bxdac` or `.json` archive).

### `summary <file>`

Session overview: metadata, duration, counts, tabs, time range.

```bash
bun run src/cli.ts summary recording.bxdac
```

### `actions <file>`

Chronological user action timeline (clicks, inputs, navigations). Excludes scroll events by default.

```bash
bun run src/cli.ts actions recording.bxdac
bun run src/cli.ts actions recording.bxdac --include-scroll
bun run src/cli.ts actions recording.bxdac --tab 12345 --type click
```

### `network <file>`

All network requests with method, URL, status, timing. Bodies truncated to 500 chars by default; headers excluded by default.

```bash
bun run src/cli.ts network recording.bxdac
bun run src/cli.ts network recording.bxdac --headers
```

### `errors <file>`

Failed network requests (4xx/5xx or errorText present) with full response bodies.

```bash
bun run src/cli.ts errors recording.bxdac
```

### `endpoints <file>`

Deduplicated API endpoints with methods, status codes, and call counts.

```bash
bun run src/cli.ts endpoints recording.bxdac
```

### `forms <file>`

Form submissions cross-referenced with preceding input/change events. Masked values preserved.

```bash
bun run src/cli.ts forms recording.bxdac
```

### `navigation <file>`

Navigation and tab lifecycle events showing URL transitions in chronological order.

```bash
bun run src/cli.ts navigation recording.bxdac
```

### `elements <file>`

Unique elements interacted with (deduplicated by selector), with action types and counts.

```bash
bun run src/cli.ts elements recording.bxdac
```

### `tabs <file>`

Tab lifecycle: creation, activation, removal with titles and URLs.

```bash
bun run src/cli.ts tabs recording.bxdac
```

### `replay <file>`

Metadata about rrweb replay events (count, time range, estimated size). Does not output full payloads by default.

```bash
bun run src/cli.ts replay recording.bxdac
bun run src/cli.ts replay recording.bxdac --full
```

### `dump <file>`

Complete archive dump, pretty-printed JSON by default.

```bash
bun run src/cli.ts dump recording.bxdac
bun run src/cli.ts dump recording.bxdac --no-replay
```

## Global Options

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

## Output Formats

### JSON (default)

Pretty-printed JSON for human inspection, debugging, or piping to other tools.

```bash
# Default JSON output
bun run src/cli.ts summary recording.bxdac

# Explicitly request JSON
bun run src/cli.ts summary recording.bxdac --format json
```

### Table

Human-readable table output.

```bash
bun run src/cli.ts network recording.bxdac --format table
```

### TOON

[TOON](https://toonformat.dev) encodes JSON using YAML-like indentation with CSV-style tabular arrays, producing a compact, human-readable representation that reduces token count for LLM context windows.

```bash
bun run src/cli.ts summary recording.bxdac --format toon
```

## Development

```bash
bun install          # Install dependencies
bun run dev          # Run CLI directly from source
bun run build        # Compile TypeScript to dist/
bun run typecheck    # Type check without emitting
bun test             # Run test suite
```

## Data Model

The CLI works with `.bxdac` files exported by the ActionCap browser extension. Each archive contains:

| Table | What it represents |
|---|---|
| `session` | Top-level metadata: scope, duration, counts |
| `tabs` | Browser tabs tracked during recording |
| `userActions` | Clicks, inputs, key presses, scrolls, navigations |
| `networkEvents` | HTTP requests/responses via Chrome DevTools Protocol |
| `replayEvents` | rrweb DOM snapshots for session replay |

Sensitive values (passwords, tokens, auth, cookies) are masked by the extension before storage. The CLI preserves `masked` flags.

## License

MIT
