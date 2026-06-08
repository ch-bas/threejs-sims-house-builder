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

## Dependency Updates

We monitor dependencies with `npm audit` and address critical/high vulnerabilities promptly. If you notice an unpatched advisory, please report it.
