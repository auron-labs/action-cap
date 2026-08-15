# External Extension API

ActionCap exposes a single `externally_connectable` message API so other browser extensions can control recordings and ingest custom events. All communication goes through `chrome.runtime.sendMessage` to ActionCap's service worker — no content-script bridge or `window.postMessage` is required.

## Setup

ActionCap's manifest declares `externally_connectable: { ids: ['*'] }`, so any extension can send messages. You need ActionCap's extension ID:

```js
const actionCapId = '<actioncap-extension-id>'
```

All requests use `chrome.runtime.sendMessage` and receive a `RuntimeResponse`:

```ts
type RuntimeResponse =
  | { ok: true; state?: RecordingStateSnapshot; sessionId?: string }
  | { ok: false; error: string }
```

## Commands

### `GET_RECORDING_STATE`

Query whether ActionCap is currently recording.

```js
chrome.runtime.sendMessage(actionCapId, { type: 'GET_RECORDING_STATE' }, (response) => {
  if (response.ok) {
    console.log(response.state.active, response.state.sessionId, response.state.scope)
  }
})
```

### `START_RECORDING`

Start a recording with a given scope. `captureScreenshots` is optional and defaults to `false`; when enabled, ActionCap captures a JPEG of the active tab's visible viewport after completed navigations. Returns an error if a recording is already active, unless `restart: true` is set.

```js
// Start recording the current tab
chrome.runtime.sendMessage(actionCapId, {
  type: 'START_RECORDING',
  scope: 'current-tab',  // 'current-tab' | 'cross-tab' | 'all-windows'
  captureScreenshots: true, // optional; defaults to false
}, (response) => {
  if (response.ok) {
    console.log('Recording started', response.state)
  } else {
    console.error(response.error) // e.g. "Recording is already active."
  }
})

// Restart: stop any active recording (without opening results) and start fresh
chrome.runtime.sendMessage(actionCapId, {
  type: 'START_RECORDING',
  scope: 'all-windows',
  restart: true,
}, (response) => {
  // ...
})
```

**Scopes:**
- `'current-tab'` — record only the active tab
- `'cross-tab'` — record all tabs in the current window
- `'all-windows'` — record all tabs across all windows

If a recording is already active and `restart` is not set, the response is `{ ok: false, error: '...' }`. With `restart: true`, the current recording is stopped silently (no results page) and a new one starts immediately.

### `STOP_RECORDING`

Stop the active recording. By default opens the results page; pass `openResults: false` to suppress it.

```js
chrome.runtime.sendMessage(actionCapId, {
  type: 'STOP_RECORDING',
  openResults: false,
}, (response) => {
  if (response.ok) {
    console.log('Stopped session', response.state)
  }
})
```

### `INGEST_ACTION`

Ingest a custom user-action event into the active session. Only valid when ActionCap is recording. The event is attributed to the sender's tab (from `sender.tab.id`).

```js
chrome.runtime.sendMessage(actionCapId, {
  type: 'INGEST_ACTION',
  event: {
    type: 'click',                 // required; see allowed types below
    url: 'https://example.com/x',  // optional; defaults to sender tab URL
    title: 'Page title',           // optional; defaults to sender tab title
    selector: '#submit-btn',       // optional
    element: {                     // optional
      tagName: 'button',
      text: 'Submit',
      id: 'submit-btn',
      className: 'btn btn-primary',
      role: 'button',
      name: 'submit',
    },
    coordinates: { x: 10, y: 20 }, // optional
    scroll: { x: 0, y: 200 },      // optional
    value: 'entered text',         // optional; masked if sensitive
    masked: false,                 // optional
    metadata: {                    // optional
      customKey: 'customValue',
    },
  },
}, (response) => {
  if (response.ok) {
    console.log('Ingested into session', response.sessionId)
  } else {
    console.error(response.error) // e.g. "Not recording" or "Unsupported action type: ..."
  }
})
```

**Allowed `type` values:** `click`, `dblclick`, `contextmenu`, `input`, `change`, `submit`, `keydown`, `keyup`, `scroll`, `focus`, `blur`, `navigation`. System-level types (`tab-activated`, `tab-created`, `tab-removed`, `window-focus`) are rejected.

**Sanitization still applies.** Values are routed through ActionCap's normal `recordUserAction` path; sensitive fields (`password`, `token`, `authorization`, `cookie`, `secret`, `phone`, `idcard`) are masked by `src/common/sanitizer.ts` as usual.

### `INGEST_REPLAY`

Ingest an rrweb-style payload event into the active session's replay stream. Only valid when ActionCap is recording. The event is attributed to the sender's tab.

```js
chrome.runtime.sendMessage(actionCapId, {
  type: 'INGEST_REPLAY',
  payload: { type: 2, data: { /* rrweb event */ } },
}, (response) => {
  if (response.ok) {
    console.log('Ingested replay event into session', response.sessionId)
  }
})
```

The `payload` is stored verbatim alongside ActionCap's own rrweb events and will be replayed in the results page's rrweb player.

## Security model

- **Extension-to-extension only.** Messages are delivered via `chrome.runtime.onMessageExternal`, which requires the sender to be an extension listed in `externally_connectable.ids`. ActionCap currently accepts all extensions (`ids: ['*']`); tighten this in `src/manifest.ts` if you need to restrict access.
- **Action type allowlist.** External callers cannot inject arbitrary `UserActionEvent.type` values. Only DOM-level action types are accepted (see above).
- **Sanitization still applies.** Ingested action values are routed through ActionCap's normal `recordUserAction` path; sensitive fields are masked.
- **No secrets.** The API never exposes ActionCap's session data beyond the session ID (a UUID). It does not return IndexedDB contents.

## Attribution

Ingested events are attributed to the tab the message originates from. The service worker stamps `tabId` from `sender.tab.id` and `frameId` from `sender.frameId`. If the message is sent from a background script (no associated tab), the response will be `{ ok: false, error: 'Missing sender tab id.' }`.

## Limitations

- `INGEST_ACTION` and `INGEST_REPLAY` require the message to be sent from a content script (so `sender.tab` is available). Sending from a background script will return an error.
- The API does not support long-lived streaming connections. For high-volume rrweb-style streams, callers should batch payloads into multiple `INGEST_REPLAY` requests.
- Browser-internal pages (`chrome://`, `edge://`, `about:`) are not supported since content scripts cannot run there.
