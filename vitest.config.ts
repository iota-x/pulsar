import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit tests only — no DB/Redis/RPC. Integration paths are mocked.
    include: ['{apps,packages}/**/src/**/*.test.ts'],
    environment: 'node',
  },
});
