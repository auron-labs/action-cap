# CLI Reference

The `@auron-labs/action-cap-cli` package is a TypeScript CLI for analyzing ActionCap extension exports (`.bxdac` session archive files) and extracting data useful for LLM agents.

## Install

Install with Bun:

```bash
bunx @auron-labs/action-cap-cli --help
# or
bun install -g @auron-labs/action-cap-cli
actioncap --help
```

Or work from source:

```bash
cd packages/action-cap-cli
bun install
```

Run directly from source (no build needed):

```bash
bun run src/cli.ts --help
```

Or build and use the compiled binary:

```bash
bun run build
./dist/cli.js --help
```

The package name on npm is `@auron-labs/action-cap-cli`. It defines a `bin` entry: `actioncap` → `./dist/cli.js`.

## Commands

Every command takes a positional `<file>` argument — a path to a `.bxdac` or `.json` archive exported by the ActionCap extension.

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

Failed network requests (4xx/5xx or errorText present) with full, untruncated response bodies.

```bash
bun run src/cli.ts errors recording.bxdac
```

### `endpoints <file>`

Deduplicated API endpoints with methods, status codes, and call counts.

```bash
bun run src/cli.ts endpoints recording.bxdac
```

### `forms <file>`

Form submissions cross-referenced with preceding input/change events. Masked values are preserved.

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

Complete archive dump as pretty-printed JSON.

```bash
bun run src/cli.ts dump recording.bxdac
bun run src/cli.ts dump recording.bxdac --no-replay
```

## Global options

These flags are available on all commands unless otherwise noted.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--format` | `json` \| `table` \| `toon` | `json` | Output format |
| `--tab` | number | — | Filter to a specific tab ID |
| `--type` | string | — | Filter by event type (comma-separated, e.g. `click,input`) |
| `--status` | string | — | Filter network by status (e.g. `4xx`, `5xx`, `200`, `>=400`) |
| `--from` | number | — | Start timestamp (ms since epoch) |
| `--to` | number | — | End timestamp (ms since epoch) |
| `--limit` | number | — | Max events to output |
| `--verbose` | boolean | `false` | Verbose logging to stderr |

Source: `packages/action-cap-cli/src/lib/args.ts`

### Command-specific flags

| Flag | Commands | Description |
|---|---|---|
| `--include-scroll` | `actions` | Include scroll events in the action timeline |
| `--headers` | `network` | Include request/response headers in output |
| `--full` | `replay` | Output full rrweb event payloads |
| `--no-replay` | `dump` | Exclude rrweb replay events from the dump |

## Output formats

### JSON (default)

Pretty-printed JSON for human inspection, debugging, or piping to other tools.

```bash
bun run src/cli.ts summary recording.bxdac
bun run src/cli.ts summary recording.bxdac --format json
```

### Table

Human-readable table output using `cli-table3`.

```bash
bun run src/cli.ts network recording.bxdac --format table
```

### TOON

[TOON](https://toonformat.dev) (Token-Oriented Object Notation) encodes JSON using YAML-like indentation with CSV-style tabular arrays, producing a compact, human-readable representation that reduces token count for LLM context windows.

```bash
bun run src/cli.ts summary recording.bxdac --format toon
```

## Filtering examples

Filter by tab ID:

```bash
bun run src/cli.ts actions recording.bxdac --tab 12345
```

Filter by event type (comma-separated):

```bash
bun run src/cli.ts actions recording.bxdac --type click,input
```

Filter network by status code:

```bash
bun run src/cli.ts network recording.bxdac --status 4xx
bun run src/cli.ts network recording.bxdac --status 500
bun run src/cli.ts network recording.bxdac --status ">=400"
```

Filter by time range (ms since epoch):

```bash
bun run src/cli.ts network recording.bxdac --from 1719900000000 --to 1719900060000
```

Limit output:

```bash
bun run src/cli.ts network recording.bxdac --limit 50
```

## Status filter syntax

The `--status` flag accepts the following formats:

| Format | Meaning | Example |
|---|---|---|
| `Nxx` | Status codes in the Nxx range (e.g. 400-499) | `4xx`, `5xx` |
| `NNN` | Exact status code | `200`, `404` |
| `>=NNN` | Greater than or equal to NNN | `>=400` |
| `>NNN` | Greater than NNN | `>500` |

Invalid formats throw: `Error: Invalid status filter: <value>. Use formats like 4xx, 5xx, 200, >=400`

Source: `packages/action-cap-cli/src/lib/filters.ts:44-68`
