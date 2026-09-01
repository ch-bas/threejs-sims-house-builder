import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Most modules under test are React-free and Three.js-free pure logic, so
    // the fast Node environment is the default. The few React-facing suites
    // (e.g. use-layout-store.react.test.ts) opt into jsdom per-file via a
    // `// @vitest-environment jsdom` comment.
    environment: 'node',
    globals: false,
    include: ['components/**/*.test.ts'],
  },
});
