---
name: action-cap-cli
description: >
  Parse and extract data from ActionCap browser extension session archives (`.bxdac` files)
  using the action-cap-cli tool. Use when analyzing recorded browser sessions, extracting
  user action timelines, network requests, form submissions, navigation flow, API endpoints,
  or preparing session data for LLM context.
version: 1.0.0
source: local
license: MIT
---

# ActionCap CLI

Extract focused views from ActionCap `.bxdac` session archive files for analysis or LLM consumption.

## Prerequisites

```bash
cd packages/action-cap-cli
bun install
```

All commands run via `bun run dev -- <command>` (from source) or `./dist/cli.js <command>` (after `bun run build`).

## File Format

`.bxdac` files are plain JSON with this structure:

```jsonc
{
  "format": "actioncap-session-archive",
  "version": 1,
  "exportedAt": 1719500000000,
  "bundle": {
    "session": { /* id, name, scope, status, startTime, endTime, counts */ },
    "tabs": [ /* tabId, windowId, title, url */ ],
    "userActions": [ /* ts, type, tabId, url, selector, element, value, masked */ ],
    "networkEvents": [ /* ts, tabId, method, url, status, requestBody, responseBody */ ],
    "replayEvents": [ /* rrweb DOM snapshots — large, binary-ish */ ]
  }
}
```

Sensitive values (passwords, tokens, cookies) are already masked by the extension before storage. The CLI preserves `masked` flags — do not unmask them.

## Commands

Every command takes a positional `<file>` argument (path to a `.bxdac` or `.json` archive).

### `summary <file>`

Quick orientation: what happened, how long, how many actions/requests.

```bash
bun run dev -- summary recording.bxdac
```

### `actions <file>`

Chronological user action timeline (clicks, inputs, navigations). Excludes scroll events by default.

```bash
bun run dev -- actions recording.bxdac
bun run dev -- actions recording.bxdac --include-scroll
bun run dev -- actions recording.bxdac --tab 12345 --type click
```

### `network <file>`

All network requests with method, URL, status, timing. Bodies truncated to 500 chars by default; headers excluded by default.

```bash
bun run dev -- network recording.bxdac
bun run dev -- network recording.bxdac --headers
```

### `errors <file>`

Failed network requests (4xx/5xx or errorText present) with full untruncated response bodies.

```bash
bun run dev -- errors recording.bxdac
```

### `endpoints <file>`

Deduplicated API endpoints (by URL pathname) with methods, status codes, and call counts.

```bash
bun run dev -- endpoints recording.bxdac
```

### `forms <file>`

Form submissions cross-referenced with preceding input/change events. Masked values preserved.

```bash
bun run dev -- forms recording.bxdac
```

### `navigation <file>`

Navigation and tab lifecycle events showing URL transitions in chronological order.

```bash
bun run dev -- navigation recording.bxdac
```

### `elements <file>`

Unique elements interacted with (deduplicated by selector), with action types and counts.

```bash
bun run dev -- elements recording.bxdac
```

### `tabs <file>`

Tab lifecycle: creation, activation, removal with titles and URLs.

```bash
bun run dev -- tabs recording.bxdac
```

### `replay <file>`

Metadata about rrweb replay events (count, time range, estimated size). Does not output full payloads by default.

```bash
bun run dev -- replay recording.bxdac
bun run dev -- replay recording.bxdac --full
```

### `dump <file>`

Complete archive dump. Use `--no-replay` to exclude rrweb events (which dominate file size).

```bash
bun run dev -- dump recording.bxdac --no-replay
```

## Output Formats

Control with `--format <json|table|toon>`. Default is `json`.

| Format | Use case |
|---|---|
| `json` (default) | Human inspection, debugging, piping to other tools |
| `table` | Human-readable terminal output |
| `toon` | Compact output for LLM context windows — YAML-like indentation with CSV-style tabular arrays |

```bash
bun run dev -- summary recording.bxdac --format toon
```

## Filters

Available on most commands:

| Flag | Example | Description |
|---|---|---|
| `--tab` | `--tab 8` | Filter to a specific tab ID |
| `--type` | `--type click,input` | Filter by event type (comma-separated) |
| `--status` | `--status 4xx` | Filter network by status (`4xx`, `5xx`, `200`, `>=400`) |
| `--from` | `--from 1719500000000` | Start timestamp (ms since epoch) |
| `--to` | `--to 1719500060000` | End timestamp (ms since epoch) |
| `--limit` | `--limit 10` | Max events to output |

## Workflow

1. Start with `summary` to understand what the recording contains.
2. Use `actions` or `navigation` to trace what the user did.
3. Use `network` or `endpoints` to inspect API calls.
4. Use `errors` to find failed requests with full response bodies.
5. Use `forms` to see submitted values (masked values stay masked).
6. Use `dump --no-replay` when you need everything except rrweb payloads.

## Verification

After changes to the CLI:

```bash
cd packages/action-cap-cli
bun run typecheck    # tsc --noEmit
bun test             # Run test suite (49 tests)
```

Smoke-test a command:

```bash
bun run dev -- summary ../../sample.bxdac --format json
bun run dev -- summary ../../sample.bxdac --format toon
bun run dev -- summary ../../sample.bxdac --format table
```
