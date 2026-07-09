# Troubleshooting

Common problems, their causes, and fixes. Issues are grouped by component.

## Extension

### Build fails with TypeScript errors

**Symptom:** `bun run build` or `bun run typecheck` reports TypeScript errors.

**Cause:** TypeScript type errors in source files.

**Fix:**

```bash
bun run typecheck
```

This runs `tsc --noEmit` and isolates the errors. Fix each error before rebuilding.

### Debugging banner appears during recording

**Symptom:** The browser shows a "debugging this browser" banner while recording.

**Cause:** Expected behavior. ActionCap uses the `debugger` permission to capture network traffic via the Chrome DevTools Protocol. The banner is a browser security measure.

**Fix:** This is normal. The banner disappears when recording stops. On Firefox, this banner does not appear because Firefox uses `webRequest` instead of `chrome.debugger`.

### Cannot record `chrome://` or `edge://` pages

**Symptom:** Recording does not capture activity on internal browser pages.

**Cause:** Internal browser pages block extension script injection. This is a browser limitation, not a bug.

**Fix:** ActionCap can only record regular web pages. There is no workaround.

### Content script does not start recording after a build

**Symptom:** After rebuilding and reloading the extension, recording does not capture page activity.

**Cause:** The extension may not be fully reloaded, or the service worker may not be running.

**Fix:**

1. Go to `chrome://extensions` or `edge://extensions`.
2. Click the reload button on the ActionCap extension.
3. Verify the service worker is registered (click "Service Worker" in the extension card to inspect it).
4. Start a new recording.

### Canceling the debugging banner ends recording

**Symptom:** Recording stops unexpectedly when the user dismisses the browser's debugging banner.

**Cause:** When the user cancels the debugging banner, `chrome.debugger.onDetach` fires with reason `canceled_by_user`. The extension calls `stopRecording()` because network capture becomes incomplete without the debugger attached.

**Fix:** This is expected behavior. Start a new recording if needed.

### Response bodies are missing or truncated

**Symptom:** Some network response bodies show `[truncated N chars]` or `[binary <mimeType> omitted]`.

**Cause:**
- Bodies larger than 1,000,000 characters are truncated to save storage space.
- Binary content (images, fonts, etc.) is not captured.
- If `Network.getResponseBody` fails, the body is set to `[failed to capture response body: <error>]`.

**Fix:** This is by design. Truncated and binary content cannot be recovered. For text-based APIs, the full body is captured up to the 1 MB limit.

### Source maps are not emitted

**Symptom:** The `dist/` folder does not contain source maps after `bun run build`.

**Cause:** Source maps are disabled by default.

**Fix:**

```bash
ACTIONCAP_SOURCE_MAPS=true bun run build
```

### `bun run test` fails

**Symptom:** Running `bun run test` fails.

**Cause:** The extension test script runs Node's built-in test runner against `src/results/payload-format.test.ts`.

**Fix:**

```bash
bun run test
```

### `bun run edge:package` or `bun run firefox:package` fails

**Symptom:** Packaging script fails with an error about `zip` not found.

**Cause:** The packaging scripts (`scripts/package-edge.mjs`, `scripts/package-firefox.mjs`) require the system `zip` CLI to be installed.

**Fix:**

1. Install `zip` on your system (e.g., `brew install zip` on macOS, or it is typically pre-installed on Linux).
2. Ensure `bun run build` (or `bun run build:firefox`) succeeded first.
3. Run the packaging command again.

## CLI

### Invalid archive format

**Symptom:** CLI exits with an `ArchiveError` and a Zod validation message.

**Cause:** The file is not a valid `.bxdac` archive. The archive must match the `actioncap-session-archive` format with a `bundle` containing `session`, `tabs`, `userActions`, `networkEvents`, and `replayEvents`.

**Fix:** Re-export the session from the ActionCap extension and try again. Ensure the file was not corrupted or truncated during transfer.

### Invalid status filter

**Symptom:** CLI exits with `Error: Invalid status filter: ...`.

**Cause:** The `--status` flag received an unrecognized format.

**Fix:** Use one of these accepted formats:

| Format | Meaning | Example |
|---|---|---|
| `Nxx` (e.g. `4xx`, `5xx`) | Status codes in the Nxx range | `--status 4xx` matches 400-499 |
| `NNN` (3-digit number) | Exact status code | `--status 200` |
| `>=NNN` | Greater than or equal | `--status >=400` |
| `>NNN` | Greater than | `--status >500` |

Source: `packages/action-cap-cli/src/lib/filters.ts:44-68`

### Command not found after build

**Symptom:** Running `actioncap` or `./dist/cli.js` fails.

**Cause:** The CLI was not built, or the binary is not on your PATH.

**Fix:**

```bash
cd packages/action-cap-cli
bun run build
./dist/cli.js --help
```

Alternatively, run from source without building:

```bash
bun run src/cli.ts --help
```
