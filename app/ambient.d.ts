// Next's ambient types, committed so a bare `tsc` sees them. `next-env.d.ts`
// carries the same references but is generated (and gitignored), so it is
// missing on a fresh checkout until `next dev`, `next build` or `next typegen`
// has run.
/// <reference types="next" />
/// <reference types="next/image-types/global" />

// Next declares `*.module.css` only. Global stylesheets are imported for their
// side effect (`import './globals.css'` in app/layout.tsx), which TypeScript 6
// checks by default (`noUncheckedSideEffectImports`, TS2882).
declare module '*.css';
