# ActionCap

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/skye-z/ActionCap/actions/workflows/ci.yaml/badge.svg)](https://github.com/skye-z/ActionCap/actions/workflows/ci.yaml)
[![Release](https://github.com/skye-z/ActionCap/actions/workflows/release.yaml/badge.svg)](https://github.com/skye-z/ActionCap/actions/workflows/release.yaml)
[![Latest Release](https://img.shields.io/github/v/release/skye-z/ActionCap)](https://github.com/skye-z/ActionCap/releases)

A browser activity recorder for Chrome, Edge, and Firefox. ActionCap captures user actions, network traffic, and rrweb replay data, stores sessions locally in IndexedDB, and lets you inspect or export them as `.bxdac` archives.

## What it does

- Record a single tab, the current window, or all browser windows.
- Capture requests, responses, user actions, and DOM replay data in one timeline.
- Replay sessions locally with rrweb and inspect payloads in the built-in results page.
- Export sessions for offline analysis with the companion CLI.

## Browser support

| Browser | Support | Notes |
|---|---|---|
| Chrome | Yes | Uses the `debugger` permission for network capture. |
| Edge | Yes | Also available from the [Microsoft Edge Add-ons Store](https://microsoftedge.microsoft.com/addons/detail/jgphnnhmpipdkklgebfhfbheagkdipnj). |
| Firefox | Yes | Use the Firefox build (`bun run build:firefox`) and load it as a temporary add-on. |

Internal browser pages such as `chrome://` and `edge://` cannot be recorded.

## Privacy and safety

- All recorded data stays on your device in IndexedDB unless you manually export it.
- ActionCap does not upload session data, analytics, or telemetry to a server.
- Sensitive fields are masked where possible, but exported `.bxdac` files can still contain highly sensitive data such as tokens, cookies, request bodies, and page content.
- Treat exported sessions as secrets and review them before sharing.

See the [Privacy Policy](docs/PRIVACY_POLICY.md) and [Permission Justification](docs/PERMISSION_JUSTIFICATION.md) for the full caveats.

## Install

### Extension

1. **Edge store:** install from the [Microsoft Edge Add-ons Store](https://microsoftedge.microsoft.com/addons/detail/jgphnnhmpipdkklgebfhfbheagkdipnj).
2. **Chrome / Edge from source:** `bun install && bun run build`, then load `dist/` from `chrome://extensions` or `edge://extensions` with **Developer mode** enabled.
3. **Firefox from source:** `bun install && bun run build:firefox`, then load `dist/` from `about:debugging#/runtime/this-firefox` as a temporary add-on.

### Companion CLI

Run the published CLI with Bun:

```bash
bunx @auron-labs/action-cap-cli --help
```

Or install it globally with Bun:

```bash
bun install -g @auron-labs/action-cap-cli
actioncap --help
```

See [docs/cli.md](docs/cli.md) for commands and examples.

## Quick usage

1. Click the ActionCap icon in the browser toolbar.
2. Choose a recording scope: current tab, current window, or all windows.
3. Click **Start Recording**. Chrome and Edge show the expected debugging banner while recording.
4. Browse normally.
5. Click the ActionCap icon again and press **Stop Recording**.
6. Open **View Sessions** to inspect the timeline, replay the session, or export a `.bxdac` archive.

## Docs

- [Development guide](docs/development.md)
- [CLI reference](docs/cli.md)
- [Privacy policy](docs/PRIVACY_POLICY.md)
- [Permission justification](docs/PERMISSION_JUSTIFICATION.md)

## License

[MIT](LICENSE)
