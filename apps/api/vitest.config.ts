import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    // Every test file truncates the same database, so files run one at a time
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
