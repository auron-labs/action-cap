# Plan: `action-cap-cli`

A TypeScript CLI package at `./packages/action-cap-cli` for analyzing ActionCap extension exports (`.bxdac` session archive files) and extracting data useful for LLM agents.

## 1. Background: What ActionCap Captures

ActionCap is a browser extension that records browser activity into IndexedDB. Users export sessions as `.bxdac` files (JSON with the `actioncap-session-archive` format). Each archive contains:

| Table | Shape | What it represents |
|---|---|---|
| `session` | `SessionRecord` | Top-level metadata: scope, duration, counts |
| `tabs` | `TrackedTabRecord[]` | Browser tabs tracked during recording |
| `userActions` | `UserActionEvent[]` | Clicks, inputs, key presses, scrolls, navigations, tab lifecycle |
| `networkEvents` | `NetworkEvent[]` | HTTP requests/responses via Chrome DevTools Protocol (headers, bodies, status, timing) |
| `replayEvents` | `ReplayEventRecord[]` | rrweb DOM snapshots for session replay (large, binary-ish) |

### Export format (`buildSessionArchive` in `src/common/storage.ts`)

```jsonc
{
  "format": "actioncap-session-archive",
  "version": 1,
  "exportedAt": 1719500000000,
  "bundle": {
    "session": { /* SessionRecord */ },
    "tabs": [ /* TrackedTabRecord[] */ ],
    "userActions": [ /* UserActionEvent[] */ ],
    "networkEvents": [ /* NetworkEvent[] */ ],
    "replayEvents": [ /* ReplayEventRecord[] */ ]
  }
}
```

Files use the `.bxdac` extension but are plain JSON. The CLI also accepts `.json`.

### Key data fields available

**SessionRecord**: `id`, `name`, `scope` (`current-tab` | `cross-tab` | `all-windows`), `status`, `startTime`, `endTime`, `startTabId`, `startWindowId`, `tabCount`, `actionCount`, `networkCount`, `replayCount`

**UserActionEvent**: `id`, `sessionId`, `tabId`, `frameId`, `ts`, `type` (click, dblclick, contextmenu, input, change, submit, keydown, keyup, scroll, focus, blur, navigation, tab-activated, tab-created, tab-removed, window-focus), `url`, `title`, `selector`, `element` (`{tagName, text, id, className, role, name}`), `coordinates`, `scroll`, `value` (masked if sensitive), `masked`, `metadata`

**NetworkEvent**: `id`, `sessionId`, `tabId`, `requestId`, `ts`, `phase` (request/response), `url`, `method`, `status`, `statusText`, `resourceType`, `mimeType`, `requestHeaders`, `responseHeaders`, `requestBody`, `responseBody`, `bodyEncoding`, `durationMs`, `initiator`, `truncated`, `errorText`

**TrackedTabRecord**: `id`, `sessionId`, `tabId`, `windowId`, `title`, `url`, `faviconUrl`, `attachedDebugger`, `firstSeenAt`, `lastSeenAt`

**ReplayEventRecord**: `id`, `sessionId`, `tabId`, `ts`, `payload` (rrweb event — large, opaque)

**Note**: Sensitive values (passwords, tokens, auth, cookies) are already masked by the extension's sanitizer (`src/common/sanitizer.ts`) before storage. The CLI does not need to re-sanitize but should preserve the `masked` flags.

---

## 2. What LLM Agents Would Find Useful

After analyzing the data model, these are the extraction views that would help an LLM agent understand a recorded session:

| View | Why an agent wants it |
|---|---|
| **session summary** | Quick orientation: what happened, how long, how many actions/requests |
| **action timeline** | Chronological human-readable log of user interactions (clicks, inputs, navigations) |
| **network requests** | API calls with method, URL, status, timing — the "what was called" view |
| **network errors** | Failed requests (4xx/5xx) with response bodies — debugging focus |
| **api endpoints** | Deduplicated list of unique endpoints called, with methods and status ranges |
| **form submissions** | Submit events with associated input values — what the user submitted |
| **navigation flow** | URL transitions across tabs — the page-flow story |
| **interacted elements** | Elements the user clicked/typed into, with selectors and text |
| **tab lifecycle** | Tab creation, activation, removal events |
| **dom snapshots** | rrweb replay events (large; offer count + size, not full payload) |
| **full dump** | Complete archive in a single TOON-compressed output (for comprehensive analysis) |

---

## 3. TOON Compression

All JSON output passes through TOON (Token-Oriented Object Notation) via the `@toon-format/toon` npm package. TOON encodes JSON using YAML-like indentation with CSV-style tabular arrays, producing a compact, human-readable representation that reduces token count for LLM context windows.

The CLI will:
- Build the requested data view as a plain JS object
- Serialize via `jsonToToon()` before writing to stdout
- Provide a `--json` flag to bypass TOON and output pretty-printed JSON (for human inspection or debugging)
- Provide a `--toon` flag (default) to explicitly request TOON output

---

## 4. Package Setup

### Location & structure

```
packages/action-cap-cli/
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── cli.ts                    # runMain(main) entrypoint
    ├── commands/
    │   ├── summary.ts            # Session overview
    │   ├── actions.ts            # User action timeline
    │   ├── network.ts            # Network requests
    │   ├── errors.ts             # Failed network requests
    │   ├── endpoints.ts          # Deduplicated API endpoints
    │   ├── forms.ts              # Form submissions
    │   ├── navigation.ts         # Navigation/page flow
    │   ├── elements.ts           # Interacted elements
    │   ├── tabs.ts               # Tab lifecycle
    │   ├── replay.ts             # rrweb snapshot metadata
    │   └── dump.ts               # Full archive dump
    ├── lib/
    │   ├── archive.ts            # .bxdac/.json file reader + parser
    │   ├── views.ts              # Data extraction/transformation functions (pure, testable)
    │   ├── output.ts             # TOON/JSON output formatting
    │   └── filters.ts           # Shared filter helpers (tab, type, status, time range)
    └── types.ts                  # Re-export ActionCap types for CLI use
```

### Package management

Per the `typescript-cli` skill:
- **Bun** for package management (`bun install`, `bun add`, `bun run`)
- This is a new package in an existing npm repo; the root uses npm with `package-lock.json`. The CLI package will use its own `bun.lock` and operate independently. The root `package.json` is `private: true` with no workspace config, so the CLI package is a standalone package in `packages/` that gets its own install.

### Dependencies

| Package | Purpose |
|---|---|
| `citty` | Command routing, args, subcommands, help text |
| `consola` | Logging (warnings, info to stderr; stdout reserved for data) |
| `pathe` | Cross-platform path handling for file args |
| `toon-json` | JSON → TOON compression for agent-friendly output |
| `zod` | Validate parsed archive structure |
| `cli-table3` | Human-readable table output (with `--table` flag) |

Dev dependencies:
| Package | Purpose |
|---|---|
| `typescript` | Type checking |
| `@types/node` | Node type defs |
| `bun` | Runtime + package manager |
| `automd` | Generated README command docs |

### `package.json` sketch

```jsonc
{
  "name": "action-cap-cli",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "actioncap": "./dist/cli.js"
  },
  "exports": {
    ".": "./dist/cli.js"
  },
  "scripts": {
    "dev": "bun run src/cli.ts",
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "bun test",
    "automd": "automd"
  },
  "dependencies": {
    "citty": "^0.1.6",
    "consola": "^3.2.3",
    "pathe": "^1.1.2",
    "toon-json": "^1.0.4",
    "zod": "^3.23.8",
    "cli-table3": "^0.6.5"
  },
  "devDependencies": {
    "typescript": "^5.5.4",
    "@types/node": "^22.0.0",
    "automd": "^0.1.1"
  }
}
```

### `tsconfig.json` sketch

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"]
}
```

---

## 5. CLI Design

### Global args (on `main`)

| Flag | Type | Default | Description |
|---|---|---|---|
| `--format` | `toon` \| `json` \| `table` | `toon` | Output format. TOON is default for agent consumption. |
| `--tab` | `number` | — | Filter to a specific tab ID. |
| `--type` | `string` | — | Filter by event type (comma-separated, e.g. `click,input`). |
| `--status` | `string` | — | Filter network by status code range (e.g. `4xx`, `5xx`, `200`, `>=400`). |
| `--from` | `number` | — | Start timestamp (ms since epoch). |
| `--to` | `number` | — | End timestamp (ms since epoch). |
| `--limit` | `number` | — | Max events to output. |
| `--verbose` | `boolean` | `false` | Verbose logging to stderr. |

### Commands

Every command takes a positional `<file>` arg (the `.bxdac` or `.json` archive path).

#### `summary <file>`

Extract: session metadata, duration, counts, tab list, time range.

Output shape:
```
{ session, duration, tabs, timeRange, counts }
```

Useful for: "What is this recording?"

#### `actions <file>`

Extract: chronological user action timeline. Each action rendered as a compact object with `ts`, `type`, `url`, `selector`, `element.tagName`, `element.text`, `value` (if not masked), `coordinates`, `metadata.key`.

Excludes `scroll` events by default (noisy); `--include-scroll` to include.

Useful for: "What did the user do?"

#### `network <file>`

Extract: all network requests. Each rendered with `ts`, `tabId`, `method`, `url`, `status`, `mimeType`, `resourceType`, `durationMs`, `requestBody` (truncated to 500 chars), `responseBody` (truncated to 500 chars), `errorText`.

Headers excluded by default (verbose); `--headers` to include.

Useful for: "What API calls were made?"

#### `errors <file>`

Extract: network events with status >= 400 or `errorText` present. Full response bodies included (not truncated).

Useful for: "What went wrong?"

#### `endpoints <file>`

Extract: deduplicated list of unique URL paths (path stripped of query string) with methods, status codes observed, and call counts.

Output shape:
```
{ endpoints: [{ path, methods: [{ method, statuses: [number], count }] }] }
```

Useful for: "What API surface was exercised?"

#### `forms <file>`

Extract: `submit` events cross-referenced with preceding `input`/`change` events on the same form. Shows what values were submitted (masked values preserved as masked).

Useful for: "What did the user submit in forms?"

#### `navigation <file>`

Extract: `navigation` and `tab-activated`/`tab-created`/`tab-removed` events in chronological order, showing URL transitions and tab lifecycle.

Output shape:
```
{ navigations: [{ ts, type, tabId, url, title }] }
```

Useful for: "What pages did the user visit and in what order?"

#### `elements <file>`

Extract: unique elements interacted with (by selector), with action types and counts. Deduplicates across many clicks on the same element.

Output shape:
```
{ elements: [{ selector, tagName, text, role, name, interactions: [{ type, count }] }] }
```

Useful for: "What UI elements were interacted with?"

#### `tabs <file>`

Extract: tab lifecycle — creation, activation, removal, with titles and URLs.

Useful for: "What tabs were open and when?"

#### `replay <file>`

Extract: metadata about rrweb replay events (count, time range, estimated size). Does NOT output full payloads (too large and not useful as text for agents).

`--full` flag outputs raw rrweb event payloads (TOON-compressed).

Useful for: "Is there replay data available?"

#### `dump <file>`

Extract: the complete archive bundle, TOON-compressed. Optionally `--no-replay` to exclude rrweb events (which dominate file size).

Useful for: "Give me everything."

---

## 6. Implementation Details

### Archive reader (`lib/archive.ts`)

```typescript
// Reads .bxdac or .json file, parses JSON, validates format with zod.
// Returns typed SessionBundle.
// Throws consola-formatted error if file missing, invalid JSON, or wrong format.
```

Zod schema validates:
- Top-level `format` === `'actioncap-session-archive'`
- `version` === `1`
- `bundle` exists with expected keys
- Individual records match ActionCap types (imported from root `src/common/types.ts`)

### Views (`lib/views.ts`)

Pure functions, one per command, each taking `SessionBundle` + filter options and returning a plain object. These are testable without any CLI machinery.

```typescript
export function sessionSummary(bundle: SessionBundle): SummaryView
export function actionTimeline(bundle: SessionBundle, opts: ActionFilterOpts): ActionView[]
export function networkRequests(bundle: NetworkFilterOpts): NetworkView[]
export function networkErrors(bundle: SessionBundle): NetworkView[]
export function apiEndpoints(bundle: SessionBundle): EndpointView[]
export function formSubmissions(bundle: SessionBundle): FormView[]
export function navigationFlow(bundle: SessionBundle): NavigationView[]
export function interactedElements(bundle: SessionBundle): ElementView[]
export function tabLifecycle(bundle: SessionBundle): TabView[]
export function replayMetadata(bundle: SessionBundle): ReplayView
```

### Output (`lib/output.ts`)

```typescript
import { jsonToToon } from 'toon-json'

export function formatOutput(data: unknown, format: 'toon' | 'json' | 'table'): string {
  switch (format) {
    case 'toon':  return jsonToToon(data)
    case 'json':  return JSON.stringify(data, null, 2)
    case 'table': return renderTable(data)  // via cli-table3
  }
}
```

TOON output goes to stdout. Table/JSON output goes to stdout. Logs/warnings go to stderr via consola.

### Filters (`lib/filters.ts`)

Shared filter logic applied across commands:
- `byTab(events, tabId)` — filter to a specific tab
- `byType(events, types[])` — filter by event type
- `byStatus(events, statusFilter)` — filter network by status code/range
- `byTimeRange(events, from, to)` — filter by timestamp
- `withLimit(events, limit)` — cap result count

---

## 7. Implementation Steps

1. **Scaffold package** — create `packages/action-cap-cli/`, `package.json`, `tsconfig.json`, directory structure.
2. **Copy types** — copy or import ActionCap types into `src/types.ts` (the extension's types use browser globals, so a clean copy is needed for Node).
3. **Implement archive reader** — `lib/archive.ts` with zod validation.
4. **Implement filters** — `lib/filters.ts`.
5. **Implement views** — `lib/views.ts`, one function per command.
6. **Implement output** — `lib/output.ts` with TOON/JSON/table formatters.
7. **Implement commands** — one Citty `defineCommand` per file in `src/commands/`.
8. **Wire entrypoint** — `src/cli.ts` with `runMain(main)` and subcommands.
9. **Write tests** — test views with fixture `.bxdac` data.
10. **Write README** — with Automd-generated command docs.
11. **Verify** — `bun run typecheck`, `bun test`, smoke-test `--help` and a sample file.

---

## 8. Example Usage

```bash
# Session summary (TOON output, default)
actioncap summary recording.bxdac

# User actions, pretty JSON for human reading
actioncap summary recording.bxdac --format json

# Network errors only
actioncap errors recording.bxdac

# API endpoints called
actioncap endpoints recording.bxdac

# Actions for a specific tab, clicks only
actioncap actions recording.bxdac --tab 12345 --type click

# Full dump without replay data (smaller for agents)
actioncap dump recording.bxdac --no-replay

# Pipe TOON output to an agent pipeline
actioncap summary recording.bxdac | agent-consumer
```

### Example TOON output (summary)

For input:
```json
{ "session": { "id": "abc", "name": "Test", "scope": "current-tab", "actionCount": 5, "networkCount": 12 } }
```

TOON output:
```
OBJ 1 STR c2Vzc2lvbg== OBJ 5 STR aWQ= STR YWJj STR bmFtZQ== STR VGVzdA== STR c2NvcGU= STR Y3VycmVudC10YWI= STR YWN0aW9uQ291bnQ= NUM 5 STR bmV0d29ya0NvdW50 NUM 12
```

This is a single line, token-dense, and decodable back to JSON via `toonToJson()`.
