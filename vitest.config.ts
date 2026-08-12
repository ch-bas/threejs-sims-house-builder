import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Modules under test are React-free and Three.js-free pure logic, so the
    // fast Node environment is sufficient — no jsdom needed.
    environment: 'node',
    globals: false,
    include: ['components/**/*.test.ts'],
  },
});
