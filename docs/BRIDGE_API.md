# External Extension Bridge API

ActionCap exposes a `window.postMessage` bridge from its content script so other browser extensions can ingest custom events into an active ActionCap recording session. This avoids manifest changes on either side and requires no `externally_connectable` configuration.

## How it works

ActionCap's content script (`src/content/recorder.ts`) installs a `message` listener on `window` at load time. Other extensions' content scripts (running on the same page) post structured messages to `window`. ActionCap validates the message shape, forwards it to its background service worker via `chrome.runtime.sendMessage`, and posts a response back to `window`.

The bridge is active on every page where ActionCap's content script is injected, regardless of whether a recording is in progress. When no recording is active, `ping` still works; ingestion requests return an error.

## Security model

- **Same-origin only.** ActionCap only accepts `message` events whose `event.source === window`. Cross-origin frames cannot drive the bridge.
- **Source tag.** Requests must set `source: 'actioncap-bridge-request'`; all responses carry `source: 'actioncap-bridge-response'`. Messages with any other `source` are ignored.
- **No secrets.** The bridge never exposes ActionCap's session data beyond the session id (a UUID). It does not return IndexedDB contents.
- **Action type allowlist.** External callers cannot inject arbitrary `UserActionEvent.type` values (e.g. `tab-activated`, `tab-removed`, `window-focus`). Only DOM-level action types are accepted (see `ALLOWED_ACTION_TYPES` in `src/content/bridge.ts`).
- **Sanitization still applies.** Values are routed through ActionCap's normal `recordUserAction` path; sensitive fields (`password`, `token`, `authorization`, `cookie`, `secret`, `phone`, `idcard`) are masked by `src/common/sanitizer.ts` as usual. Do not weaken this.

## Request format

Post a message with `window.postMessage`:

```js
window.postMessage(
  {
    source: 'actioncap-bridge-request',
    id: '<unique-string>',
    type: 'ping' | 'ingest-action' | 'ingest-replay',
    // ...type-specific fields
  },
  location.origin,
)
```

Every request MUST include a unique `id` (any string). Responses are correlated by `id`.

### `ping`

Query whether ActionCap is currently recording on this tab. No ingestion happens.

```js
window.postMessage(
  {
    source: 'actioncap-bridge-request',
    id: 'req-1',
    type: 'ping',
  },
  location.origin,
)
```

### `ingest-action`

Ingest a custom user-action event into the active session. Only valid when ActionCap is recording.

```js
window.postMessage(
  {
    source: 'actioncap-bridge-request',
    id: 'req-2',
    type: 'ingest-action',
    event: {
      type: 'click',                 // required; see allowed types below
      url: 'https://example.com/x',  // optional; defaults to location.href
      title: 'Page title',           // optional; defaults to document.title
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
  },
  location.origin,
)
```

**Allowed `type` values:** `click`, `dblclick`, `contextmenu`, `input`, `change`, `submit`, `keydown`, `keyup`, `scroll`, `focus`, `blur`, `navigation`. System-level types (`tab-activated`, `tab-created`, `tab-removed`, `window-focus`) are rejected.

### `ingest-replay`

Ingest an rrweb-style payload event into the active session's replay stream. Only valid when ActionCap is recording.

```js
window.postMessage(
  {
    source: 'actioncap-bridge-request',
    id: 'req-3',
    type: 'ingest-replay',
    payload: { type: 2, data: { /* rrweb event */ } },
  },
  location.origin,
)
```

The `payload` is stored verbatim alongside ActionCap's own rrweb events and will be replayed in the results page's rrweb player.

## Response format

ActionCap posts a response back to `window`:

```js
window.addEventListener('message', (event) => {
  if (event.source !== window) return
  const data = event.data
  if (data?.source !== 'actioncap-bridge-response') return

  // data.id matches the request id
  // data.ok is true on success, false on error
  // data.recording is true if ActionCap is currently recording
  // data.sessionId is the active session id (when recording)
  // data.error is a string on failure
})
```

| Field | Type | Description |
|---|---|---|
| `source` | `'actioncap-bridge-response'` | Fixed marker |
| `id` | `string` | Matches request `id` |
| `ok` | `boolean` | `true` on success, `false` on error |
| `recording` | `boolean` | Whether ActionCap is currently recording |
| `sessionId` | `string?` | Active session UUID, when recording |
| `error` | `string?` | Error message, when `ok === false` |

## End-to-end example

```js
// In another extension's content script

function sendToActionCap(request) {
  return new Promise((resolve) => {
    const id = crypto.randomUUID()

    const onResponse = (event) => {
      if (event.source !== window) return
      const data = event.data
      if (data?.source !== 'actioncap-bridge-response' || data.id !== id) return
      window.removeEventListener('message', onResponse)
      resolve(data)
    }

    window.addEventListener('message', onResponse)
    window.postMessage({ ...request, source: 'actioncap-bridge-request', id }, location.origin)
  })
}

// Check if ActionCap is recording
const ping = await sendToActionCap({ type: 'ping' })
if (!ping.ok || !ping.recording) {
  console.log('ActionCap is not recording')
  return
}

// Ingest a custom click event
const result = await sendToActionCap({
  type: 'ingest-action',
  event: {
    type: 'click',
    selector: '#my-button',
    element: { tagName: 'button', text: 'My Button' },
    metadata: { source: 'my-extension', action: 'custom-click' },
  },
})
console.log('Ingest result:', result.ok)
```

## Attribution

Events ingested via the bridge are attributed to the tab the content script runs in. The service worker stamps `tabId` from `sender.tab.id` and `frameId` from `sender.frameId`, just as it does for ActionCap's own recorded events. The bridge sets `tabId: -1` and `frameId: 0` on the event before sending it; the service worker overrides those with the real values.

## Limitations

- The bridge only works on pages where ActionCap's content script is injected. Browser-internal pages (`chrome://`, `edge://`, `about:`) are not supported.
- External extensions cannot start or stop recordings through the bridge. Use the ActionCap popup or keyboard shortcuts for that.
- The bridge does not support long-lived streaming connections. For high-volume rrweb-style streams, callers should batch payloads into multiple `ingest-replay` requests.
- Page scripts (not just extensions) can also call `window.postMessage`. The bridge does not authenticate callers beyond checking `event.source === window`. If you need stronger isolation, host your extension's content script in an isolated world and gate on a secret token exchanged out-of-band.

## Testing the bridge locally

```bash
# Run the bridge unit tests
node --test src/content/bridge.test.ts
```

The tests cover: `ping` while idle and recording, `ingest-action` success and rejection of disallowed types, `ingest-replay` forwarding, ignoring of non-bridge messages, and listener cleanup.
