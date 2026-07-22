# Session Page Upgrade Plan

This document outlines a phased plan to improve the **usability** and **stability** of the
results/session page (`src/results/results-app.tsx` + `src/results/styles.css`).

The current page is a single ~800-line React component that renders the session list,
timeline, detail panel, replay player, and payload modals. It works well for small sessions
but degrades rapidly as session size grows, and several UX patterns are missing that users
expect from a debugging/replay tool.

---

## Phase 1 — Stability (critical, do first)

### 1.1 Virtualize the timeline and session list

**Problem:** `buildTimeline` produces a flat array and the timeline panel renders every item
as a DOM button in a single scroll container. A session with 5,000+ network requests and
actions creates 5,000+ DOM nodes, causing jank and high memory usage. The session list has
the same issue when hundreds of sessions are stored.

**Plan:**
- Introduce a lightweight virtualization layer (`@tanstack/react-virtual` or a custom
  windowed renderer) for the `.timeline-list` and `.session-list` containers.
- Each virtualized row reuses the existing `timeline-item` / `session-card` markup.
- Measure row height once (items have fixed height) and only render visible rows + a small
  overscan buffer.
- Keep the non-virtualized path as a fallback for very small lists (< 50 items) to avoid
  unnecessary overhead.

**Files:** `src/results/results-app.tsx`, new `src/results/virtual-list.ts` utility.

### 1.2 Add React error boundaries

**Problem:** A single uncaught exception in any sub-component (e.g. malformed replay event
payload, unexpected network event shape) crashes the entire page with a blank screen.

**Plan:**
- Wrap the three main regions (session list, timeline+detail, replay) in separate
  `ErrorBoundary` components.
- Each boundary renders a localized fallback message with a "reload" button that re-mounts
  the subtree without a full page refresh.
- Log the error to `console.error` for debugging.

**Files:** new `src/results/error-boundary.tsx`, `src/results/results-app.tsx`.

### 1.3 Add loading and error states to `useSessionData`

**Problem:** `useSessionData` returns an empty bundle while loading. The UI shows
"no events" / "no matching sessions" instead of a loading indicator, which is misleading.

**Plan:**
- Add `status: 'loading' | 'loaded' | 'error'` and `error` to the hook's return value.
- Show a skeleton/spinner in the session list and timeline while `status === 'loading'`.
- Show an error fallback if `status === 'error'`.
- Wrap the `getSessionBundle` / `listSessions` calls in try/catch.

**Files:** `src/results/results-app.tsx`.

### 1.4 Guard replay event payloads

**Problem:** `ReplayPanel` maps `replayEvents` to `item.payload` and passes them directly to
`rrweb-player` with `as any[]`. A corrupted or non-rrweb payload can crash the player or
produce a blank canvas with no feedback.

**Plan:**
- Filter out payloads that don't look like rrweb events (check for `type` and `data`
  fields before passing to the player).
- If all events are filtered out, show the existing "no replay data" message.
- Wrap the `new rrwebPlayer(...)` call in a try/catch and show an error fallback.

**Files:** `src/results/results-app.tsx` (`ReplayPanel`).

### 1.5 Debounce session reload and avoid redundant bundle fetches

**Problem:** `useSessionData` re-fetches the full session bundle whenever `reloadToken`
changes. Operations like rename, delete, import, and clean-all all call `reload()`, which
re-fetches the entire bundle even when only the session metadata changed.

**Plan:**
- Split the hook into `useSessionList` (lightweight, only session metadata) and
  `useSessionBundle` (heavy, full event data).
- `reload()` should only re-fetch what changed: pass a flag indicating whether the
  bundle or just the session list needs refreshing.
- For rename operations, update the local session state optimistically instead of
  re-fetching.

**Files:** `src/results/results-app.tsx`.

---

## Phase 2 — Usability (high priority)

### 2.1 Keyboard navigation in the timeline

**Problem:** The timeline is a list of buttons but has no keyboard navigation beyond tab.
Users cannot use arrow keys to move between events, and there is no "jump to next error"
shortcut.

**Plan:**
- Add `ArrowUp` / `ArrowDown` to move selection to the previous/next timeline item.
- Add `ArrowRight` / `ArrowLeft` to move to the next/previous tab in the tab filter.
- Add `e` to jump to the next network error.
- Add `/` to focus the timeline search input.
- Show a keyboard shortcuts help tooltip (triggered by `?`).

**Files:** `src/results/results-app.tsx`, `src/results/styles.css`.

### 2.2 Persist view state across session switches and page reloads

**Problem:** Tab filter, timeline filter, search query, and view mode (timeline/replay) are
stored in React state and URL params. Switching sessions resets tab filter and selected
item. Reloading the page preserves `sessionId` and `view` but loses filters and search.

**Plan:**
- Extend `syncUrl` to also persist `tabFilter`, `filter`, and `search` as URL params.
- On session switch, keep the filter/search but reset `tabFilter` to `'all'` (since tab
  IDs differ between sessions) and clear `selectedId`.
- Use `history.replaceState` to avoid polluting browser history.

**Files:** `src/results/results-app.tsx`.

### 2.3 Add a session overview/summary view

**Problem:** When a session is selected, the user immediately sees the timeline. There is
no high-level summary showing total duration, action breakdown by type, network status
code distribution, or a list of tabs with their event counts.

**Plan:**
- Add a third view mode: "Overview" alongside "Timeline" and "Replay".
- The overview shows:
  - Session metadata (name, scope, duration, start/end time).
  - Stat cards: total actions, total network requests, error count, replay events.
  - Action type breakdown (bar chart or list with counts).
  - Network status code distribution (2xx/3xx/4xx/5xx counts).
  - Tab list with per-tab event counts.
- This gives users a quick orientation before diving into the timeline.

**Files:** `src/results/results-app.tsx`, `src/results/styles.css`.

### 2.4 Improve the timeline with relative timestamps and grouping

**Problem:** Each timeline item shows an absolute timestamp (`formatDate`). For debugging,
relative time from session start ("+12s") or from the previous event is more useful.

**Plan:**
- Show relative time from session start as the primary timestamp.
- Add optional visual grouping by time gaps (e.g. insert a separator when > 5 seconds
  pass between consecutive events).
- Keep absolute time as a tooltip on hover.

**Files:** `src/results/results-app.tsx`, `src/results/styles.css`.

### 2.5 Add a mini-map / scrubber for the timeline

**Problem:** With hundreds or thousands of events, scrolling through the flat list to find
a specific moment is tedious. There is no way to jump to a point in time visually.

**Plan:**
- Add a thin horizontal bar above the timeline list that shows a density visualization of
  events over the session duration (actions in one color, network in another, errors
  highlighted).
- Clicking on the bar scrolls the timeline list to that time range.
- This complements (not replaces) the existing scroll list.

**Files:** `src/results/results-app.tsx`, `src/results/styles.css`.

### 2.6 Add batch selection and bulk delete in the session list

**Problem:** Users can only delete sessions one at a time or clean all. There is no way to
select multiple sessions and delete them together.

**Plan:**
- Add a checkbox or multi-select mode to the session list.
- Show a "Delete Selected" button when sessions are selected.
- Reuse the `ConfirmModal` for confirmation.
- Show the count of selected sessions in the confirmation message.

**Files:** `src/results/results-app.tsx`, `src/results/styles.css`.

---

## Phase 3 — Code maintainability (medium priority)

### 3.1 Split `results-app.tsx` into focused modules

**Problem:** The single 800-line file contains all components, hooks, utility functions,
and the top-level app. This makes it hard to navigate, test, and review.

**Plan:**
- Extract into:
  - `src/results/hooks/use-session-data.ts` — data loading hooks.
  - `src/results/components/timeline.tsx` — timeline list + item rendering.
  - `src/results/components/detail-panel.tsx` — action and network detail panels.
  - `src/results/components/replay-panel.tsx` — rrweb player wrapper.
  - `src/results/components/session-list.tsx` — session list + browser grid.
  - `src/results/components/payload-viewer.tsx` — payload viewer + modal.
  - `src/results/components/confirm-modal.tsx` — reusable confirmation modal.
  - `src/results/utils.ts` — formatting and timeline building utilities.
  - `src/results/results-app.tsx` — top-level layout and state orchestration only.

**Files:** new files under `src/results/`.

### 3.2 Add unit tests for timeline building and formatting utilities

**Problem:** `buildTimeline`, `buildNetworkPairs`, `summarizeAction`, and the payload
formatters have no test coverage. Regressions in these functions are hard to catch.

**Plan:**
- Add `src/results/utils.test.ts` with Node test runner (`node --test`).
- Test: timeline ordering, filter combinations, network pair matching, error detection,
  search matching.
- Test: payload formatting for JSON, HTML, base64, empty bodies.
- Run via `bun run test` (extend the existing test script if needed).

**Files:** new `src/results/utils.test.ts`, `package.json` (test script).

### 3.3 Extract shared modal and button styles

**Problem:** The `PayloadModal` and `ConfirmModal` share the same backdrop and card
structure but duplicate styling knowledge. Button styles (`.ghost`, `.danger`, `.primary`)
are scattered across CSS.

**Plan:**
- Create a shared `Modal` component that provides the backdrop, card, escape-key handling,
  and click-outside-to-close behavior.
- `PayloadModal` and `ConfirmModal` become thin wrappers.
- Consolidate button style definitions into a single section of the CSS.

**Files:** `src/results/components/`, `src/results/styles.css`.

---

## Phase 4 — Performance (lower priority, measure first)

### 4.1 Lazy-load the rrweb-player

**Problem:** `rrweb-player` is imported at the top of `results-app.tsx` and bundled into
the results page chunk. Users who only browse the session list or timeline never use the
replay view but still download the player code.

**Plan:**
- Use `React.lazy(() => import('rrweb-player'))` for the `ReplayPanel` component.
- Wrap in `Suspense` with a loading fallback.
- This reduces initial JS parse time for the results page.

**Files:** `src/results/results-app.tsx` (or `src/results/components/replay-panel.tsx`
after 3.1).

### 4.2 Paginate or cursor-load session list

**Problem:** `listSessions` loads all session records from IndexedDB at once. With hundreds
of sessions this is slow and memory-heavy.

**Plan:**
- Use Dexie's `.limit()` and `.offset()` or cursor-based pagination.
- Load the first 50 sessions, then load more on scroll (infinite scroll) or via a "Load
  More" button.
- Keep the search filter working on loaded sessions; for unloaded sessions, fall back to
  a server-side-style query on the `name` index.

**Files:** `src/common/storage.ts`, `src/results/results-app.tsx`.

### 4.3 Stream large session bundles with incremental loading

**Problem:** `getSessionBundle` fetches all tabs, user actions, network events, and replay
events for a session in a single `Promise.all`. For a long recording session this can be
megabytes of data loaded at once.

**Plan:**
- Load session metadata + tabs first (fast).
- Load timeline events (user actions + network events) in the background.
- Load replay events only when the user switches to the replay view.
- Show progressive loading indicators in each panel.

**Files:** `src/common/storage.ts`, `src/results/results-app.tsx`.

---

## Implementation order

| Priority | Phase | Effort | Impact |
|----------|-------|--------|--------|
| 1 | 1.1 Virtualize timeline | Medium | High — fixes jank on large sessions |
| 2 | 1.2 Error boundaries | Small | High — prevents blank-screen crashes |
| 3 | 1.3 Loading states | Small | Medium — fixes misleading empty states |
| 4 | 1.4 Guard replay payloads | Small | Medium — prevents player crashes |
| 5 | 2.1 Keyboard navigation | Medium | High — core UX for a debugging tool |
| 6 | 2.2 Persist view state | Small | Medium — reduces repetitive clicks |
| 7 | 3.1 Split into modules | Medium | Medium — enables all future work |
| 8 | 2.3 Session overview | Medium | Medium — quick orientation |
| 9 | 1.5 Debounce reloads | Small | Medium — reduces redundant work |
| 10 | 2.4 Relative timestamps | Small | Medium — better debugging context |
| 11 | 4.1 Lazy-load player | Small | Low — only helps initial load |
| 12 | 2.5 Timeline mini-map | Large | Medium — nice for large sessions |
| 13 | 2.6 Batch delete | Medium | Low — nice to have |
| 14 | 3.2 Unit tests | Medium | Medium — long-term safety |
| 15 | 3.3 Shared modal styles | Small | Low — cleanup |
| 16 | 4.2 Paginate session list | Medium | Low — only helps with many sessions |
| 17 | 4.3 Stream bundles | Large | Low — only helps with huge sessions |

Each item can be implemented independently. The recommended approach is to tackle Phase 1
(stability) first, then Phase 2 (usability), interleaving Phase 3 (maintainability) items
as natural refactoring opportunities arise during feature work.
