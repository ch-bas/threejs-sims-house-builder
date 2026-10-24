# Contributing

Thanks for your interest in contributing to the Three.js Sims-like House Builder! Here's how to get started.

## Getting Started

You need Node.js 22 or newer (`.nvmrc` pins 22; on Node 20 the jsdom tests crash).

```bash
git clone https://github.com/ch-bas/threejs-sims-house-builder.git
cd threejs-sims-house-builder
npm install
npm run dev
```

Open `http://localhost:3000` to see the app (Next moves to `http://localhost:3001` when 3000 is taken).

## Development

CI runs these three on every pull request, and branch protection on `main` requires them to pass:

- **Type-check:** `npm run typecheck`
- **Lint:** `npm run lint -- --max-warnings=0` (a warning fails CI)
- **Test:** `npm run test` (the Vitest unit suite)

`npm run build` makes the static export in `out/`; serve it with `npm start` (`next start` doesn't work on a static export).

Before you change a module, read its line in [docs/architecture.md](docs/architecture.md) and the relevant [design notes](docs/design-notes.md). A new module gets a line in `docs/architecture.md` in the same pull request (a unit test checks), and a change that sets a new rule gets a design note. The [wiki](https://github.com/ch-bas/threejs-sims-house-builder/wiki) covers the [architecture](https://github.com/ch-bas/threejs-sims-house-builder/wiki/Architecture), [rendering](https://github.com/ch-bas/threejs-sims-house-builder/wiki/Rendering), [data safety](https://github.com/ch-bas/threejs-sims-house-builder/wiki/Data-safety) and [testing](https://github.com/ch-bas/threejs-sims-house-builder/wiki/Development-and-testing).

## How to Contribute

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-change`
3. Make your changes
4. Run the three checks above: `npm run typecheck`, `npm run lint -- --max-warnings=0` and `npm run test`
5. Commit with a clear message describing what and why
6. Push to your fork and open a Pull Request

## What to Work On

- Check [open issues](https://github.com/ch-bas/threejs-sims-house-builder/issues) for bugs and feature requests
- Issues labeled `good first issue` are a great starting point
- If you want to add a new furniture item, see `components/room-organizer/lib/constants.ts` for the catalog and `components/room-organizer/three/builders/` for the 3D mesh builders (register a new builder in `three/furniture-builders.ts`)

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
