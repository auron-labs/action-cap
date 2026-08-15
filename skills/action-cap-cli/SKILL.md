---
name: action-cap-cli
description: >
  Parse and extract data from ActionCap browser extension session archives (`.bxdac` files)
  using the Go actioncap CLI. Use when analyzing recorded browser sessions, extracting
  user action timelines, network requests, screenshots, form submissions, navigation flow,
  API endpoints, or preparing session data for LLM context.
version: 1.1.0
source: local
license: MIT
---

# ActionCap CLI

Extract focused views from ActionCap `.bxdac` session archives for analysis or LLM consumption.

## Prerequisites

The CLI is a Go module under `packages/action-cap-cli`. Use Go 1.26.5 or newer; it has no external runtime dependencies.

```bash
cd packages/action-cap-cli
go version
```

Run from source with `go run ./cmd/actioncap <command> ...`, or build the binary with `go build -o actioncap ./cmd/actioncap` and run `./actioncap <command> ...`.

## File Format

`.bxdac` files are JSON archives with this structure:

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
    "replayEvents": [ /* rrweb DOM snapshots */ ]
  }
}
```

Sensitive values are masked by the extension where applicable, but archives and extracted screenshots can still contain sensitive data. Handle them accordingly.

## Commands

Every command takes a positional `<file>` argument. Put flags before the archive path.

| Command | Purpose |
|---|---|
| `summary` | Session metadata, duration, counts, tabs, and time range |
| `actions` | Chronological user action timeline; scroll events are excluded by default |
| `network` | Network requests with method, URL, status, and timing |
| `errors` | Failed network requests with response bodies |
| `endpoints` | Deduplicated API endpoints |
| `forms` | Form submissions with associated input values |
| `navigation` | Navigation and tab lifecycle events |
| `elements` | Unique interacted elements |
| `tabs` | Tab lifecycle events |
| `replay` | rrweb replay metadata; use `--full` for raw payloads |
| `screenshots` | Extract JPEG screenshots from `metadata.screenshot` user actions |
| `dump` | Complete archive dump; use `--no-replay` to omit rrweb events |

Examples:

```bash
go run ./cmd/actioncap summary recording.bxdac
go run ./cmd/actioncap actions --include-scroll recording.bxdac
go run ./cmd/actioncap network --headers recording.bxdac
go run ./cmd/actioncap errors recording.bxdac
go run ./cmd/actioncap endpoints recording.bxdac
go run ./cmd/actioncap forms recording.bxdac
go run ./cmd/actioncap navigation recording.bxdac
go run ./cmd/actioncap elements recording.bxdac
go run ./cmd/actioncap tabs recording.bxdac
go run ./cmd/actioncap replay --full recording.bxdac
go run ./cmd/actioncap dump --no-replay recording.bxdac
```

### `screenshots`

Extract `data:image/jpeg;base64,...` screenshots referenced by user-action metadata. `--output-dir` is required. Files use deterministic chronological `.jpg` names, are written with mode `0600`, and may overwrite the same names on reruns. The output directory is created only when screenshots are found.

```bash
go run ./cmd/actioncap screenshots --output-dir ./screenshots recording.bxdac
go run ./cmd/actioncap screenshots --format table --output-dir ./screenshots recording.bxdac
go run ./cmd/actioncap screenshots --format toon --output-dir ./screenshots recording.bxdac
```

The command prints a manifest containing the count and each file path with timestamp, tab ID, URL, and event ID. It never prints the base64 image data. Treat the extracted files as sensitive.

## Output Formats

Use `--format json|table|toon`; JSON is the default.

```bash
go run ./cmd/actioncap summary --format json recording.bxdac
go run ./cmd/actioncap summary --format table recording.bxdac
go run ./cmd/actioncap summary --format toon recording.bxdac
```

## Common Filters

Available on applicable commands:

| Flag | Example | Description |
|---|---|---|
| `--tab` | `--tab 8` | Filter to a specific tab ID |
| `--type` | `--type click,input` | Filter by event type |
| `--status` | `--status 4xx` | Filter network status |
| `--from` | `--from 1719500000000` | Start timestamp in milliseconds |
| `--to` | `--to 1719500060000` | End timestamp in milliseconds |
| `--limit` | `--limit 10` | Maximum events to output |

## Workflow

1. Start with `summary` to understand the recording.
2. Use `actions` or `navigation` to trace what the user did.
3. Use `network` or `endpoints` to inspect API calls.
4. Use `errors` to find failed requests.
5. Use `forms` to inspect submitted values while preserving masking.
6. Use `screenshots --output-dir DIR` when visual evidence is needed.
7. Use `dump --no-replay` when everything except rrweb payloads is needed.

## Verification

After changing the CLI:

```bash
cd packages/action-cap-cli
gofmt -w internal/cli/cli.go internal/cli/screenshots.go internal/cli/screenshots_test.go
go test ./...
go build ./cmd/actioncap
```

Smoke-test a command:

```bash
go run ./cmd/actioncap summary --format json internal/archive/testdata/sample.bxdac
go run ./cmd/actioncap screenshots --output-dir ./screenshots internal/archive/testdata/sample.bxdac
```
