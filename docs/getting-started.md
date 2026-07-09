# Getting Started

This guide covers installing both the ActionCap browser extension and the ActionCap CLI, making your first recording, and exporting it for analysis.

## Prerequisites

### Browser extension

- **[Bun](https://bun.sh)** runtime
- A Chromium-based browser (Chrome or Edge) or Firefox 115+

### CLI

- **[Bun](https://bun.sh)** runtime (used to install dependencies, run tests, and execute the CLI)
- No environment files are required

## Install the browser extension

### From the Edge Add-ons Store (recommended)

Install directly from the [Microsoft Edge Add-ons Store](https://microsoftedge.microsoft.com/addons/detail/jgphnnhmpipdkklgebfhfbheagkdipnj).

### Manual install from source

```bash
git clone https://github.com/skye-z/ActionCap.git
cd ActionCap
bun install
```

Build for Chrome or Edge:

```bash
bun run build
```

Build for Firefox:

```bash
bun run build:firefox
```

Load the built extension:

| Browser | Steps |
|---|---|
| Chrome / Edge | Open `chrome://extensions` or `edge://extensions` → enable **Developer mode** → click **Load unpacked** → select the `dist/` folder |
| Firefox | Open `about:debugging#/runtime/this-firefox` → click **Load Temporary Add-on** → select any file inside the `dist/` folder |

## Install the CLI

```bash
bunx @auron-labs/action-cap-cli --help
```

Or work from source:

```bash
cd packages/action-cap-cli
bun install
```

Run directly from source (no build step needed):

```bash
bun run src/cli.ts --help
```

Or build and use the compiled binary:

```bash
bun run build
./dist/cli.js --help
```

## Your first recording

1. Click the ActionCap icon in the browser toolbar.
2. Select a recording scope:
   - **Current Tab** — record activity in a single tab
   - **Across Tabs** — record all tabs in the current window
   - **All Windows** — record all tabs across every browser window
3. Click **Start Recording**. The browser will display a debugging notice bar — this is expected (Chrome/Edge only; Firefox does not show it).
4. Browse normally. All network requests, user actions, and DOM changes are captured.
5. Click the ActionCap icon again and press **Stop Recording**.
6. Click **View Sessions** to open the results page. Review the timeline, inspect request details, or replay the session.

## Export a session

1. In the results page, find the session you want to export.
2. Use the export control to download a `.bxdac` file (JSON format).

## Analyze a session with the CLI

```bash
# Summary of the session
bun run src/cli.ts summary recording.bxdac

# Chronological user actions
bun run src/cli.ts actions recording.bxdac

# All network requests
bun run src/cli.ts network recording.bxdac

# Failed requests only (4xx/5xx)
bun run src/cli.ts errors recording.bxdac
```

See the [CLI Reference](cli.md) for the full command list and options.

## Verification

Confirm the extension is working:

- The ActionCap icon appears in the browser toolbar.
- Clicking it opens the popup with scope selection and a Start Recording button.
- After recording, the results page opens with a timeline of events.

Confirm the CLI is working:

```bash
cd packages/action-cap-cli
bun run src/cli.ts summary ../sample.bxdac
```

The repository includes a sample archive at `sample.bxdac` (extension root) and at `packages/action-cap-cli/test/fixtures/sample.bxdac` (CLI test fixture).

## Next steps

- [Configuration](configuration.md) — learn about build targets and environment variables
- [CLI Reference](cli.md) — explore all CLI commands and output formats
- [Architecture](architecture.md) — understand how the extension works internally
