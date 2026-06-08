# Contributing

Thanks for your interest in contributing to the Three.js Sims House Builder! Here's how to get started.

## Getting Started

```bash
git clone https://github.com/ch-bas/threejs-sims-house-builder.git
cd threejs-sims-house-builder
npm install
npm run dev
```

Open `http://localhost:3000` to see the app.

## Development

- **Type-check:** `npm run typecheck`
- **Lint:** `npm run lint`
- **Build:** `npm run build`

## How to Contribute

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-change`
3. Make your changes
4. Run `npm run typecheck` to ensure no type errors
5. Commit with a clear message describing what and why
6. Push to your fork and open a Pull Request

## What to Work On

- Check [open issues](https://github.com/ch-bas/threejs-sims-house-builder/issues) for bugs and feature requests
- Issues labeled `good first issue` are a great starting point
- If you want to add a new furniture item, see `components/room-organizer/lib/constants.ts` for the catalog and `components/room-organizer/three/builders/` for the 3D mesh builders

## Guidelines

- Keep PRs focused on a single change
- Follow the existing code style (TypeScript strict, no `any`)
- Pure functions go in `lib/`, Three.js code in `three/`, React hooks in `hooks/`, UI in `panels/`
- Don't add runtime dependencies without discussion — the app is intentionally lightweight
- Test your changes in both 3D and 2D views, and check undo/redo still works

## Reporting Bugs

Use the [Bug Report](https://github.com/ch-bas/threejs-sims-house-builder/issues/new?template=bug_report.md) issue template. Include browser, OS, and steps to reproduce.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.
