# ActionCap Documentation

ActionCap is a Manifest V3 browser extension for Chrome, Edge, and Firefox that records browser activity — user actions, network requests/responses, and DOM snapshots — then displays them in a local results page with timeline, filtering, and session replay. A companion CLI parses exported `.bxdac` session archives for analysis or LLM consumption.

All recorded data is stored locally in IndexedDB. Nothing is uploaded to any server.

## Components

| Component | Location | Description |
|---|---|---|
| Browser extension | Repository root (`src/`, `popup.html`, `results.html`) | MV3 extension that records browser sessions |
| CLI tool | `packages/action-cap-cli/` | TypeScript CLI for analyzing exported `.bxdac` archives |

## Documentation index

| Document | Purpose |
|---|---|
| [Getting Started](getting-started.md) | Prerequisites, installation, first recording, basic workflow |
| [Configuration](configuration.md) | Environment variables, build targets, config files, defaults |
| [CLI Reference](cli.md) | CLI commands, options, output formats, and examples |
| [Architecture](architecture.md) | Extension architecture, control flow, and entry points |
| [Data Model](data-model.md) | Database schema, archive format, event types |
| [Development](development.md) | Local development, testing, building, packaging |
| [Troubleshooting](troubleshooting.md) | Common problems, causes, and fixes |
| [Privacy Policy](PRIVACY_POLICY.md) | Sensitive-data handling, local storage, export warnings |
| [Permission Justification](PERMISSION_JUSTIFICATION.md) | Why each browser permission is required |

## Recommended reading order

1. **Getting Started** — install the extension and CLI, make your first recording
2. **Configuration** — understand build targets and environment variables
3. **Architecture** — learn how the extension works internally
4. **CLI Reference** — analyze exported sessions from the command line
5. **Data Model** — understand the structure of recorded data
6. **Development** — contribute to the project
7. **Troubleshooting** — resolve common issues

## Known limitations

- **Internal browser pages** (`chrome://`, `edge://`, `about:`) cannot be recorded. Extension content scripts are blocked from injecting on these pages.
- **Debugging banner** (Chrome/Edge): the `debugger` permission causes the browser to display a "debugging this browser" banner while recording is active. This is expected and disappears when recording stops. Firefox does not show this banner.
- **Response body truncation**: response bodies larger than 1,000,000 characters are truncated. Binary content (images, fonts, etc.) is omitted entirely.
- **Service worker lifecycle**: the MV3 service worker may be terminated by the browser during long recordings. ActionCap restores active recording state from `chrome.storage.local` on restart, but brief gaps are possible during reattachment.
- **Firefox temporary add-on**: Firefox builds must be loaded as temporary add-ons, which are removed when the browser closes. There is no persistent install path from source.
- **No remote sync**: all data is stored locally in IndexedDB. There is no cloud sync, account system, or server-side storage.
