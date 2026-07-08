# AGENTS.md

## Project overview

ActionCap is a Chrome/Edge Manifest V3 browser extension that records browser activity. It captures user actions, network requests/responses via the Chrome DevTools Protocol, and DOM snapshots using rrweb, then displays them in a local results page. All data is stored locally in IndexedDB.

- TypeScript + React 18
- Vite 5 + `@crxjs/vite-plugin` for the extension build
- Dexie (IndexedDB) for local storage
- rrweb + rrweb-player for DOM recording and replay
- highlight.js for payload syntax highlighting

## Source-of-truth files

- Extension manifest: `src/manifest.ts`
- Build config: `vite.config.ts`
- TypeScript config: `tsconfig.json`
- Package scripts: `package.json`
- Database schema: `src/common/storage.ts`
- Permission/privacy docs: `docs/PERMISSION_JUSTIFICATION.md`, `docs/PRIVACY_POLICY.md`
- Localization: `public/_locales/en/messages.json`, `public/_locales/zh_CN/messages.json`

## Commands

| Purpose | Command | When to run |
|---|---|---|
| Install dependencies | `npm install` | Fresh checkout or dependency changes |
| Start dev server | `npm run dev` | Local development (HMR for extension pages) |
| Build extension | `npm run build` | Before testing the packaged extension or releasing |
| Build Firefox extension | `npm run build:firefox` | Before testing in Firefox or releasing for Firefox |
| Type check | `npm run typecheck` | After TypeScript changes |
| Package for Edge store | `npm run edge:package` | After `build` to create `artifacts/edge/actioncap-edge-v*.zip` |
| Run payload-format tests | `node --test src/results/payload-format.test.ts` | After editing `payload-format.ts` or its tests |

Note: there is no `npm test` script. The only test file is `src/results/payload-format.test.ts` and uses Node's built-in test runner.

## Setup

- Use Node.js compatible with this project (lockfile is `package-lock.json` if present; npm is the package manager).
- Install dependencies with `npm install`.
- No environment files are required for local development or build.
- The build does not require local services.
- Chrome/Edge: `npm run build` then load `dist/` as an unpacked extension via `chrome://extensions` or `edge://extensions` with Developer mode enabled.
- Firefox: `npm run build:firefox` then load `dist/` as a temporary add-on via `about:debugging#/runtime/this-firefox` (Load Temporary Add-on). The Firefox build uses `webRequest` + `filterResponseData` instead of `chrome.debugger` for network capture, so no debugging banner appears during recording.

## Development workflow

- `npm run dev` starts the Vite dev server. For an extension, you will typically load the built `dist/` folder into the browser in developer mode after running `npm run build`.
- After `npm run build`, load the `dist/` directory as an unpacked extension via `chrome://extensions` or `edge://extensions` with Developer mode enabled.
- The `popup.html` and `results.html` entry points are declared in `vite.config.ts` and `src/manifest.ts`.
- The service worker is `src/background/service-worker.ts`, declared in `src/manifest.ts` as `background.service_worker` with `type: 'module'`.
- The content script is `src/content/recorder.ts`, injected at `document_start` for all URLs.

## Testing

- Run payload-format tests: `node --test src/results/payload-format.test.ts`
- There is no framework test suite. Add Node test files next to the source they test (e.g., `src/foo/bar.test.ts`) and run them with `node --test`.
- `tsconfig.json` excludes `src/**/*.test.ts` from the project, so tests do not affect the build.

## Change-aware validation

1. Check changed files with `git status --short`.
2. After TypeScript changes, run `npm run typecheck`.
3. After changes to `src/results/payload-format.ts`, run `node --test src/results/payload-format.test.ts`.
4. Before any release-impacting change, run `npm run build`.
5. If you changed the manifest, build output, or packaging logic, run `npm run edge:package` to verify the store archive is produced.

## Code style

- No linter or formatter is configured. Match the existing 2-space indentation and single-quote style.
- Use named imports/exports; prefer explicit return types only when it clarifies public APIs.
- React components are in PascalCase files under `src/popup/` and `src/results/`.
- Common utilities live under `src/common/`.
- Error strings are localized via `t()` in `src/common/i18n.ts`; add keys to both `zh-CN` and `en-US` message objects.

## Repository layout

- `src/background/` — MV3 service worker. Orchestrates recording, debugger attachment, and network capture.
- `src/content/` — Content script injected into pages. Captures user actions and rrweb replay events.
- `src/popup/` — React popup UI.
- `src/results/` — React results page UI (session list, timeline, replay, payload viewer).
- `src/common/` — Shared types, i18n, storage, sanitizer, selectors, recording state, session utilities.
- `src/manifest.ts` — Extension manifest definition.
- `public/` — Static assets (icons, `_locales/` for manifest strings).
- `scripts/` — Helper scripts: `package-edge.mjs` builds the Edge store zip; `generate-edge-assets.py` generates store promotional images.
- `docs/` — Human-facing permission and privacy documentation.

## Architecture and control flow

- Recording starts from the popup via `chrome.runtime.sendMessage({ type: 'START_RECORDING', scope })`.
- `service-worker.ts` creates a session in IndexedDB, attaches the `chrome.debugger` to each tab in scope (Chrome/Edge only), and sends `START_RECORDING` to content scripts.
- On Firefox, network capture uses `browser.webRequest` with `filterResponseData` instead of `chrome.debugger`. See `src/common/firefox-network-capture.ts`. The build target is selected by the `ACTIONCAP_BROWSER` env var (see `vite.config.ts` and `src/manifest.ts`).
- `recorder.ts` bootstraps by sending `CONTENT_BOOTSTRAP_REQUEST` to the service worker; if a recording is active for that tab, it starts rrweb recording and DOM event listeners.
- User actions and rrweb events are sent from the content script to the service worker and stored in Dexie tables (`userActions`, `replayEvents`).
- Network events are captured via `chrome.debugger` CDP `Network.*` events and stored in `networkEvents`.
- Tab lifecycle events (`tab-activated`, `tab-created`, `tab-removed`, `window-focus`, `navigation`) are recorded by the service worker.
- Stopping the recording detaches debuggers, flushes final stats, and opens `results.html?sessionId=<id>`.
- The results page reads the session bundle from IndexedDB and renders a timeline and rrweb replay.

## Generated files and code generation

- `dist/` is generated by `npm run build`. Do not edit it directly.
- `artifacts/edge/` is generated by `npm run edge:package`. Do not edit it directly.
- Both are gitignored.
- `store-assets/` is generated by `scripts/generate-edge-assets.py` (requires Pillow in a system Python environment). It is not part of the npm build.

## Database

- IndexedDB is accessed via Dexie in `src/common/storage.ts`.
- The database schema is defined in `ActionCapDB` with versions 1 and 2. Version 2 added the `name` index to `sessions`.
- Tables: `sessions`, `tabs`, `userActions`, `networkEvents`, `replayEvents`.
- Do not run destructive reset operations on user data unless explicitly requested.

## Dependencies

- Use `npm`. Do not switch to pnpm or yarn.
- Add runtime dependencies with `npm install <pkg>`. Add dev dependencies with `npm install -D <pkg>`.
- Avoid adding new runtime dependencies unless necessary; the extension ships its own bundle, so bundle size matters.

## Security and privacy

- This extension handles extremely sensitive data: passwords, tokens, cookies, request/response bodies, and full page DOM snapshots.
- `src/common/sanitizer.ts` masks values for keys containing `password`, `token`, `authorization`, `cookie`, `secret`, `phone`, `idcard`, and masks `type="password"` inputs. Do not weaken this logic.
- All captured data stays in IndexedDB unless the user explicitly exports a `.bxdac` session file.
- Never commit real credentials, `.env` files, or exported session files.
- The extension requires the `debugger` permission, which causes the browser to show a debugging banner while recording. This is expected and documented in `docs/PERMISSION_JUSTIFICATION.md`.
- The `chrome.debugger.onDetach` listener ends the recording if the user cancels the browser's debugging banner, since network capture becomes incomplete.

## PR and final checks

- Run `npm run typecheck` after TypeScript changes.
- Run `npm run build` before any release-impacting change.
- Run `node --test src/results/payload-format.test.ts` if you changed payload formatting logic.
- If the manifest or icons changed, run `npm run edge:package` to verify the store archive is produced.
- Do not weaken sanitizer, masking, or permission logic.
- Keep localization keys in sync across both `zh-CN` and `en-US` in `src/common/i18n.ts`.

## Known pitfalls

- `npm test` does not exist. Use `node --test src/results/payload-format.test.ts` directly.
- `npm run edge:package` requires the `zip` CLI to be installed.
- `npm run build` only emits source maps when `ACTIONCAP_SOURCE_MAPS=true` is set.
- The extension cannot record `chrome://` or `edge://` pages. Internal browser pages block extension script injection.
- The content script is injected at `document_start`, so it may bootstrap before the service worker is ready; bootstrap message failures are intentionally ignored.
- The service worker restores an active recording from `chrome.storage.local` on init and re-attaches debuggers to previously tracked tabs.
- The `results.html` page is a `web_accessible_resource` so it can be opened from the service worker.
- The popup and results page share `src/common/recording-state.ts` for the active recording snapshot key (`activeRecording`) and shape.

## Troubleshooting

- If `npm run build` fails with TypeScript errors, run `npm run typecheck` to isolate them.
- If `npm run edge:package` fails, ensure `zip` is installed and `npm run build` succeeded first.
- If the content script does not start recording after a build, verify the extension is reloaded and the service worker is running.
