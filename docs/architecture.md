# Architecture

How the ActionCap extension is structured and how data flows through it during recording and playback.

## Tech stack

| Layer | Technology |
|---|---|
| UI framework | React 18 |
| Build tool | Vite 5 + `@crxjs/vite-plugin` |
| Language | TypeScript (strict mode, ES2022) |
| Local storage | Dexie (IndexedDB wrapper) |
| DOM recording | rrweb + rrweb-player |
| Syntax highlighting | highlight.js |
| Manifest version | MV3 |

## Entry points

| Entry | File | Purpose |
|---|---|---|
| Manifest definition | `src/manifest.ts` | Defines permissions, content scripts, background, web-accessible resources |
| Popup HTML | `popup.html` → `src/popup/main.tsx` | Control popup for starting/stopping recordings |
| Results HTML | `results.html` → `src/results/main.tsx` | Results page with timeline, network details, and replay |
| Service worker | `src/background/service-worker.ts` | MV3 background — orchestrates recording, debugger, network capture |
| Content script | `src/content/recorder.ts` | Injected into pages — captures user actions and rrweb events |

## Directory layout

```
src/
├── background/
│   └── service-worker.ts      # Recording orchestration, CDP, tab lifecycle
├── content/
│   └── recorder.ts             # User action + rrweb capture in page context
├── popup/
│   ├── main.tsx               # Popup React entry
│   ├── popup-app.tsx          # Popup UI component
│   └── styles.css
├── results/
│   ├── main.tsx               # Results page React entry
│   ├── results-app.tsx        # Results UI component
│   ├── payload-format.ts      # Payload formatting for detail viewer
│   └── styles.css
├── common/
│   ├── types.ts               # Shared TypeScript types and message types
│   ├── storage.ts             # Dexie database schema and session I/O
│   ├── sanitizer.ts           # Sensitive data masking and body truncation
│   ├── selectors.ts           # Element selector generation
│   ├── recording-state.ts     # Active recording snapshot (shared key/shape)
│   ├── session-utils.ts       # Session utility functions
│   ├── i18n.ts                # Localization (en-US / zh-CN)
│   ├── browser-target.ts      # Compile-time browser target branching
│   └── firefox-network-capture.ts  # Firefox webRequest-based network capture
├── manifest.ts                # Extension manifest (MV3)
└── global.d.ts                # Global type for __BROWSER_TARGET__
```

## Control flow

### Starting a recording

1. User clicks the ActionCap toolbar icon → popup opens.
2. User selects a scope (Current Tab / Across Tabs / All Windows) and clicks **Start Recording**.
3. Popup sends `chrome.runtime.sendMessage({ type: 'START_RECORDING', scope })` to the service worker.
4. The service worker (`src/background/service-worker.ts`):
   - Creates a session record in IndexedDB.
   - On Chrome/Edge: attaches `chrome.debugger` to each tab in scope (CDP protocol version 1.3, `Network.enable`).
   - On Firefox: activates `browser.webRequest` with `filterResponseData` for network capture.
   - Sends `START_RECORDING` message to content scripts in scoped tabs.
   - Persists active recording state to `chrome.storage.local`.

### During recording

- **Content script** (`src/content/recorder.ts`):
  - Bootstraps by sending `CONTENT_BOOTSTRAP_REQUEST` to the service worker. If recording is active for that tab, it starts rrweb recording and DOM event listeners. Bootstrap failures are intentionally ignored because the content script runs at `document_start` and may execute before the service worker is ready.
  - Captures: clicks, double-clicks, right-clicks, keyboard input, form submissions, scrolling, focus changes, page navigations.
  - Generates stable selectors for each element (`data-testid` > `id` > `name` > `aria-label` > CSS path).
  - Sends `RECORDED_USER_ACTION` and `RECORDED_RRWEB_EVENT` messages to the service worker.

- **Service worker**:
  - Receives user action and rrweb events from content scripts → stores in Dexie tables (`userActions`, `replayEvents`).
  - Captures network events via CDP `Network.*` events (Chrome/Edge) or `webRequest` (Firefox) → stores in `networkEvents`.
  - Records tab lifecycle events: `tab-activated`, `tab-created`, `tab-removed`, `window-focus`, `navigation`.
  - Applies sanitization: masks sensitive headers/values, truncates large response bodies, omits binary content.

### Stopping a recording

1. User clicks the ActionCap icon → popup → **Stop Recording**.
2. The service worker:
   - Detaches debuggers (Chrome/Edge).
   - Flushes final stats.
   - Updates the session record (end time, counts).
   - Opens `results.html?sessionId=<id>` in a new tab.

### Service worker restoration

On init, the service worker restores an active recording from `chrome.storage.local` and re-attaches debuggers to previously tracked tabs. This handles the case where the service worker is terminated and restarted by the browser during a recording.

Source: `src/background/service-worker.ts:42-54`

## Message API

The extension communicates via `chrome.runtime.sendMessage` with these message types (defined in `src/common/types.ts:139-149`):

| Message type | Direction | Purpose |
|---|---|---|
| `GET_RECORDING_STATE` | Popup → Service worker | Query active recording status |
| `START_RECORDING` | Popup → Service worker | Start recording with `{ scope: RecordingScope }` |
| `STOP_RECORDING` | Popup → Service worker | Stop active recording |
| `CONTENT_BOOTSTRAP_REQUEST` | Content script → Service worker | Ask if recording is active for this tab |
| `RECORDED_USER_ACTION` | Content script → Service worker | Send a `UserActionEvent` |
| `RECORDED_RRWEB_EVENT` | Content script → Service worker | Send a `ReplayEventRecord` |

## Network capture

### Chrome / Edge (CDP)

The service worker attaches `chrome.debugger` with protocol version `1.3` and enables the `Network` domain. It listens for:

- `Network.requestWillBeSent`
- `Network.requestWillBeSentExtraInfo`
- `Network.responseReceived`
- `Network.responseReceivedExtraInfo`
- `Network.loadingFinished`
- `Network.loadingFailed`
- `Network.getResponseBody` (called on finish to fetch the response body)

If `Network.getResponseBody` fails, the body is set to `[failed to capture response body: <error>]`.

Source: `src/background/service-worker.ts:216-217, 599-766`

### Firefox (webRequest)

Firefox uses `browser.webRequest` with `filterResponseData` instead of `chrome.debugger`. No debugging banner appears during recording. The implementation is in `src/common/firefox-network-capture.ts`.

## Results page

The results page (`results.html`) reads the session bundle from IndexedDB and renders:

- A unified timeline with network events and user actions displayed chronologically.
- Filtering by type: All / Actions / Network / Errors.
- Search across actions, requests, and URLs.
- A detail panel with a formatted payload viewer (syntax-highlighted via highlight.js).
- Session replay using rrweb-player.

## Browser target selection

The build target is selected at compile time via the `ACTIONCAP_BROWSER` environment variable:

- `firefox` → Firefox build (webRequest, no debugger banner, background scripts, Gecko manifest settings)
- Any other value or unset → Chrome/Edge build (debugger, service worker)

The target is injected as a compile-time constant `__BROWSER_TARGET__` (defined in `vite.config.ts:13`) and used in `src/common/browser-target.ts` for runtime branching.

See [Configuration](configuration.md) for details.
