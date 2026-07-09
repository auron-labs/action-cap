# Security Policy

## Supported Versions

ActionCap is in early development. Security fixes are applied to the latest `main` branch and included in the next release.

## Reporting a Vulnerability

If you discover a security vulnerability in ActionCap, please report it responsibly:

1. **Do not** open a public GitHub issue.
2. Email the maintainer at the address listed in the GitHub profile: [skytozeac@gmail.com](mailto:skytozeac@gmail.com) or send a private vulnerability report via GitHub's Security Advisories feature (Security tab > Report a vulnerability).
3. Include a description of the issue, steps to reproduce, and any relevant logs or screenshots.

You should receive a response within 72 hours. Please do not publicly disclose the vulnerability until it has been addressed.

## Security considerations

ActionCap captures sensitive browser data including:

- Network request/response headers and bodies
- DOM snapshots
- User input events (clicks, keystrokes, form submissions)

All data is stored locally in IndexedDB. It never leaves the user's device unless they explicitly export a session as a `.bxdac` file.

The extension automatically masks values for sensitive keys (`password`, `token`, `authorization`, `cookie`, `secret`, `phone`, `idcard`) and masks `type="password"` input fields. This masking **cannot** be weakened.

Exported `.bxdac` files may still contain sensitive data that was not caught by the masking rules. Users should treat exported files as sensitive and avoid sharing them with untrusted parties.

For more detail, see:

- [docs/PRIVACY_POLICY.md](docs/PRIVACY_POLICY.md) for storage, export, and privacy expectations
- [docs/PERMISSION_JUSTIFICATION.md](docs/PERMISSION_JUSTIFICATION.md) for browser permission rationale
