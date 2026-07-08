# Configuration

ActionCap uses environment variables, TypeScript config files, and a manifest definition to control the build and runtime behavior. No `.env` files are required for local development.

## Environment variables

### `ACTIONCAP_BROWSER`

Selects the browser target for the extension build.

| Value | Behavior |
|---|---|
| `firefox` | Builds for Firefox: uses `webRequest` + `webRequestBlocking` for network capture, adds `browser_specific_settings.gecko` to manifest, uses background scripts instead of a service worker |
| Any other value or unset | Builds for Chrome/Edge: uses `debugger` permission and `chrome.debugger` CDP for network capture, uses a service worker background |

Read in:
- `vite.config.ts:8` — determines the `browser` option passed to `@crxjs/vite-plugin`
- `src/manifest.ts:5` — determines permissions, background script type, and Firefox-specific settings

Used by the `build:firefox` script:

```bash
npm run build:firefox
```

Which runs:

```
ACTIONCAP_BROWSER=firefox tsc --noEmit && ACTIONCAP_BROWSER=firefox vite build
```

### `ACTIONCAP_SOURCE_MAPS`

Controls whether source maps are emitted during the build.

| Value | Behavior |
|---|---|
| `true` | Source maps are emitted in `dist/` |
| Any other value or unset | No source maps emitted |

Read in `vite.config.ts:16`:

```ts
sourcemap: process.env.ACTIONCAP_SOURCE_MAPS === 'true',
```

Usage:

```bash
ACTIONCAP_SOURCE_MAPS=true npm run build
```

## Config files

### `vite.config.ts` (extension)

The Vite build configuration for the extension.

| Setting | Value | Source |
|---|---|---|
| Plugins | `@vitejs/plugin-react`, `@crxjs/vite-plugin` | `vite.config.ts:11` |
| Browser target | From `ACTIONCAP_BROWSER` env var | `vite.config.ts:8` |
| `__BROWSER_TARGET__` define | Stringified browser target for compile-time branching | `vite.config.ts:13` |
| Rollup inputs | `popup.html`, `results.html` | `vite.config.ts:18-21` |
| Source maps | From `ACTIONCAP_SOURCE_MAPS` env var | `vite.config.ts:16` |

### `tsconfig.json` (extension)

| Setting | Value |
|---|---|
| Target | ES2022 |
| Strict mode | Enabled |
| `noEmit` | `true` (Vite handles emission) |
| JSX | `react-jsx` |
| Test files excluded | `src/**/*.test.ts` |

### `src/manifest.ts` (extension)

Defines the Manifest V3 extension manifest. Key settings:

| Property | Value |
|---|---|
| `manifest_version` | 3 |
| `version` | `0.1.0` |
| `default_locale` | `en` |
| Permissions (Chrome/Edge) | `storage`, `tabs`, `scripting`, `webNavigation`, `debugger` |
| Permissions (Firefox) | `storage`, `tabs`, `scripting`, `webNavigation`, `webRequest`, `webRequestBlocking` |
| Host permissions | `<all_urls>` |
| Content script | `src/content/recorder.ts` at `document_start` for all URLs |
| Background (Chrome/Edge) | Service worker: `src/background/service-worker.ts` |
| Background (Firefox) | Background script: `src/background/service-worker.ts` |
| Web-accessible resources | `results.html` |
| Firefox Gecko ID | `actioncap@actioncap.dev` |
| Firefox min version | `115.0` |

### `packages/action-cap-cli/tsconfig.json` (CLI)

| Setting | Value |
|---|---|
| Target | ES2022 |
| Strict mode | Enabled |
| Output directory | `./dist` |
| Declarations | Generated |

## Localization

The extension supports two locales for manifest strings:

| Locale | File |
|---|---|
| English | `public/_locales/en/messages.json` |
| Simplified Chinese | `public/_locales/zh_CN/messages.json` |

Application UI strings (in-app, not manifest) are defined in `src/common/i18n.ts`. The locale is auto-detected:

- China timezones → `zh-CN`
- All other timezones → `en-US`

Source: `src/common/i18n.ts:5-11, 262-267`

## Sensitive data masking

The sanitizer (`src/common/sanitizer.ts`) automatically masks values whose keys contain any of these tokens (case-insensitive):

- `password`, `token`, `authorization`, `cookie`, `secret`, `phone`, `idcard`

Masked values are replaced with `***`. Input fields with `type="password"` are also masked.

Source: `src/common/sanitizer.ts:1-38`

## Response body truncation

| Condition | Behavior |
|---|---|
| Body length ≤ 1,000,000 chars | Stored in full |
| Body length > 1,000,000 chars | Truncated to 1,000,000 chars with a `[truncated N chars]` suffix |
| Binary MIME type | Body replaced with `[binary <mimeType> omitted]` |

Source: `src/common/sanitizer.ts:54-67`

## CLI defaults

The CLI has no configuration file. All behavior is controlled by command-line flags.

| Option | Default | Accepted values |
|---|---|---|
| `--format` | `json` | `json`, `table`, `toon` |
| `--verbose` | `false` | boolean |

See [CLI Reference](cli.md) for full option details.
