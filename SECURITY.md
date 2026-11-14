# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly.

**Do not open a public issue.** Instead:

1. Go to the [Security Advisories](https://github.com/ch-bas/threejs-sims-house-builder/security/advisories) page and click **"Report a vulnerability"**
2. Include steps to reproduce, affected components, and potential impact
3. If possible, suggest a fix or mitigation

## What to Expect

- You will receive an acknowledgment within **48 hours**
- We will investigate and provide an update within **7 days**
- If the vulnerability is confirmed, we will release a fix and credit you (unless you prefer to remain anonymous)

## Scope

This policy covers:

- The application code in this repository
- Dependencies listed in `package.json` / `package-lock.json`
- The GitHub Pages deployment at `ch-bas.github.io/threejs-sims-house-builder`

This application runs entirely client-side with no backend, authentication, or user data storage. The primary security concerns are:

- **Dependency vulnerabilities** — outdated npm packages with known CVEs
- **XSS via share URLs** — malicious layout data encoded in the URL hash
- **XSS via JSON import** — crafted layout files loaded through the import feature

## Content Security Policy

The deployed pages carry a Content-Security-Policy `<meta>` tag, added after `next build` by `scripts/add-csp.mjs`. It allows script files only from the app's own `_next/` folder (`https://ch-bas.github.io/threejs-sims-house-builder/_next/`) plus the SHA-256 hashes of that build's inline scripts, and it blocks plugins, `<base>` rewriting and form submission. Inline event handlers (`onclick="…"` and the like) are not allowed; the step fails the build if one appears in the exported HTML.

GitHub Pages cannot send custom response headers, and a `<meta>` policy ignores `frame-ancestors`, so the site cannot stop other pages from framing it (clickjacking). The app has no accounts or server-side actions for a framing page to abuse, so this is accepted rather than worked around with a script-based frame-buster.

## Shared origin (accepted risk)

GitHub Pages serves every project site of an account from the same origin, `https://ch-bas.github.io`. The builder therefore shares that origin with the account's other project sites, today and in the future. Two consequences:

- **Storage.** Any page on the origin can read, overwrite or delete the builder's `localStorage` keys (`standalone-room-organizer-*`: the house, the library and the restore points), and all of them draw on one storage quota of about 5 MB, so a sibling that stores a lot makes the builder's saves fail sooner.
- **Scripts.** A plain `'self'` in the policy would allow a script from any path on the origin. The policy names the app's own `_next/` path instead, so a page of the builder won't load a script file from a sibling site. Styles, images, fonts and fetches still allow the whole origin.
- **Scripting from a sibling.** The narrowing only governs what the builder's own pages load. Same-origin pages can script each other: a sibling page can open the builder in an iframe or with `window.open` and then read and change its page, its storage and its house directly, and the CSP can't prevent that. `frame-ancestors` would stop the framing, but it only works as an HTTP header, which GitHub Pages can't send.

Only a custom domain gives the app an origin of its own. Until then, these risks are accepted: the account's other sites are under the same owner, the saves can be exported as JSON and backups, and nothing secret is stored.

## Dependency Updates

We monitor dependencies with `npm audit` and address critical/high vulnerabilities promptly. If you notice an unpatched advisory, please report it.
