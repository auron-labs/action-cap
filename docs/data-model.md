# Data Model

How ActionCap stores recorded data — in the browser's IndexedDB during recording and in `.bxdac` archive files when exported.

## IndexedDB schema

The extension uses Dexie to manage IndexedDB. The database is named `actioncap-db` and has two schema versions:

| Version | Change | Source |
|---|---|---|
| 1 | Initial schema | `src/common/storage.ts:22-28` |
| 2 | Added `name` index to `sessions` table | `src/common/storage.ts:30-36` |

### Tables

| Table | Primary key | Indexes |
|---|---|---|
| `sessions` | `id` | `name`, `status`, `startTime`, `endTime`, `scope` |
| `tabs` | `id` | `sessionId`, `tabId`, `windowId`, `[sessionId+tabId]`, `firstSeenAt` |
| `userActions` | `id` | `sessionId`, `tabId`, `ts`, `type`, `[sessionId+ts]`, `[sessionId+tabId]` |
| `networkEvents` | `id` | `sessionId`, `tabId`, `ts`, `phase`, `requestId`, `[sessionId+ts]`, `[sessionId+tabId]` |
| `replayEvents` | `id` | `sessionId`, `tabId`, `ts`, `[sessionId+ts]`, `[sessionId+tabId]` |

Source: `src/common/storage.ts:12-38`

## Session archive format (`.bxdac`)

Exported sessions use the `.bxdac` extension (JSON format). The archive structure is validated by Zod in the CLI (`packages/action-cap-cli/src/lib/archive.ts:121-128`):

```jsonc
{
  "format": "actioncap-session-archive",
  "version": 1,
  "exportedAt": 1719900000000,
  "bundle": {
    "session": { /* SessionRecord */ },
    "tabs": [ /* TrackedTabRecord[] */ ],
    "userActions": [ /* UserActionEvent[] */ ],
    "networkEvents": [ /* NetworkEvent[] */ ],
    "replayEvents": [ /* ReplayEventRecord[] */ ]
  }
}
```

Source: `src/common/storage.ts:42-47`

## Data types

### SessionRecord

Top-level metadata for a recording session.

| Field | Type | Description |
|---|---|---|
| `id` | string | UUID |
| `name` | string \| undefined | User-assigned session name |
| `status` | string | `recording`, `stopped`, or `failed` |
| `scope` | string | Recording scope: `current-tab`, `cross-tab`, or `all-windows` |
| `startTime` | number | Start timestamp (ms since epoch) |
| `endTime` | number \| undefined | End timestamp |
| `startTabId` | number | Tab where recording started |
| `startWindowId` | number | Window where recording started |
| `tabCount` | number | Number of tracked tabs |
| `actionCount` | number | Number of user actions |
| `networkCount` | number | Number of network events |
| `replayCount` | number | Number of rrweb replay events |

Source: `src/common/types.ts:23-36`, `packages/action-cap-cli/src/types.ts:21-34`

### TrackedTabRecord

A browser tab tracked during recording.

| Field | Type | Description |
|---|---|---|
| `id` | string | Composite ID (`<sessionId>:<tabId>`) |
| `sessionId` | string | Parent session ID |
| `tabId` | number | Browser tab ID |
| `windowId` | number | Browser window ID |
| `title` | string \| undefined | Tab title |
| `url` | string \| undefined | Tab URL |
| `faviconUrl` | string \| undefined | Tab favicon URL |
| `attachedDebugger` | boolean | Whether the Chrome debugger is attached to this tab |
| `firstSeenAt` | number | When the tab was first tracked |
| `lastSeenAt` | number | Last activity timestamp |

Source: `src/common/types.ts:38-49`, `packages/action-cap-cli/src/types.ts:36-47`

### UserActionEvent

A single user interaction event.

| Field | Type | Description |
|---|---|---|
| `id` | string | UUID |
| `sessionId` | string | Parent session ID |
| `tabId` | number | Tab where the action occurred |
| `frameId` | number | Frame ID (default 0) |
| `ts` | number | Timestamp (ms since epoch) |
| `type` | string | Action type (see below) |
| `url` | string | Page URL at time of action |
| `title` | string \| undefined | Page title |
| `selector` | string \| undefined | Stable element selector |
| `element` | object \| undefined | Element snapshot (tagName, text, id, className, role, name) |
| `coordinates` | object \| undefined | `{ x, y }` click coordinates |
| `scroll` | object \| undefined | `{ x, y }` scroll position |
| `value` | string \| undefined | Input value (may be masked) |
| `masked` | boolean \| undefined | Whether the value was masked |
| `metadata` | object \| undefined | Additional key-value metadata |

**Action types:** `click`, `dblclick`, `contextmenu`, `input`, `change`, `keydown`, `keyup`, `submit`, `scroll`, `focus`, `blur`, `navigation`, `tab-activated`, `tab-created`, `tab-removed`, `window-focus`

Source: `src/common/types.ts:60-76`, `packages/action-cap-cli/src/types.ts:58-74`

### NetworkEvent

A network request/response event captured via CDP or webRequest.

| Field | Type | Description |
|---|---|---|
| `id` | string | UUID |
| `sessionId` | string | Parent session ID |
| `tabId` | number | Tab where the request originated |
| `requestId` | string | CDP request ID |
| `ts` | number | Timestamp (ms since epoch) |
| `phase` | `'request'` \| `'response'` | Whether this event represents the request or response phase |
| `url` | string | Request URL |
| `method` | string \| undefined | HTTP method |
| `status` | number \| undefined | HTTP status code |
| `statusText` | string \| undefined | HTTP status text |
| `resourceType` | string \| undefined | CDP resource type |
| `mimeType` | string \| undefined | Response MIME type |
| `requestHeaders` | object \| undefined | Request headers (sensitive keys masked) |
| `responseHeaders` | object \| undefined | Response headers (sensitive keys masked) |
| `requestBody` | string \| undefined | Request body |
| `responseBody` | string \| undefined | Response body (truncated if > 1MB, omitted if binary) |
| `bodyEncoding` | `'plain'` \| `'base64'` \| undefined | Encoding of the response body |
| `durationMs` | number \| undefined | Request duration in milliseconds |
| `initiator` | string \| undefined | Request initiator |
| `truncated` | boolean \| undefined | Whether the response body was truncated |
| `errorText` | string \| undefined | Error text if the request failed |

Source: `src/common/types.ts:78-100`, `packages/action-cap-cli/src/types.ts:76-98`

### ReplayEventRecord

An rrweb DOM snapshot event for session replay.

| Field | Type | Description |
|---|---|---|
| `id` | string | UUID |
| `sessionId` | string | Parent session ID |
| `tabId` | number | Tab where the event was recorded |
| `ts` | number | Timestamp (ms since epoch) |
| `payload` | unknown | rrweb event data (full DOM snapshot or incremental change) |

Source: `src/common/types.ts:102-108`, `packages/action-cap-cli/src/types.ts:100-106`

## Sensitive data handling

### Masking

Values whose keys contain any of these tokens (case-insensitive) are masked:

`password`, `token`, `authorization`, `cookie`, `secret`, `phone`, `idcard`

- Header values and input field values are replaced with `***`.
- Printable keys (keyboard input on sensitive fields) are replaced with `[masked]`. Control keys are never masked.
- Input fields with `type="password"` or whose `name`/`id`/`aria-label` matches a sensitive token are also masked.

The `masked` boolean flag is preserved in exported archives.

Source: `src/common/sanitizer.ts:1-69`

### Truncation

| Condition | Behavior |
|---|---|
| Body length ≤ 1,000,000 chars | Stored in full |
| Body length > 1,000,000 chars | Truncated with `...[truncated N chars]` suffix |
| Non-text MIME type | Body replaced with `[binary <mimeType> omitted]` |
| `Network.getResponseBody` fails | Body set to `[failed to capture response body: <error>]` |

Source: `src/common/sanitizer.ts:101-114`, `src/background/service-worker.ts:707-712`

## CLI archive parsing

The CLI validates `.bxdac` archives using Zod schemas. If validation fails, it throws an `ArchiveError` with details about which field failed validation.

The CLI parser (`parseArchive` in `packages/action-cap-cli/src/lib/archive.ts:155-166`) accepts only the full archive format (with `format`, `version`, `exportedAt`, `bundle` fields). It does not accept bare bundles.

The extension's import logic (`asSessionBundle` in `src/common/storage.ts:80-100`) accepts both the full archive format and bare bundles (for backward compatibility with older exports).

Source: `packages/action-cap-cli/src/lib/archive.ts:155-166`, `src/common/storage.ts:80-100`
