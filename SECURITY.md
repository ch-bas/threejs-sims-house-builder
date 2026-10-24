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

The deployed pages carry a Content-Security-Policy `<meta>` tag, added after `next build` by `scripts/add-csp.mjs`. It allows scripts only from the site's own origin plus the SHA-256 hashes of that build's inline scripts, and it blocks plugins, `<base>` rewriting and form submission. Inline event handlers (`onclick="…"` and the like) are not allowed; the step fails the build if one appears in the exported HTML.

GitHub Pages cannot send custom response headers, and a `<meta>` policy ignores `frame-ancestors`, so the site cannot stop other pages from framing it (clickjacking). The app has no accounts or server-side actions for a framing page to abuse, so this is accepted rather than worked around with a script-based frame-buster.

## Dependency Updates

We monitor dependencies with `npm audit` and address critical/high vulnerabilities promptly. If you notice an unpatched advisory, please report it.
