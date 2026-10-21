import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for the end-to-end tests: the built Snap in the MetaMask Snaps simulation, on plain Node.
 * Run `npm run build` first (the `test:e2e` script does). Each test file starts its own Snap sandbox in a worker
 * thread, so files run one at a time and get a generous timeout.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['e2e/**/*.e2e.test.ts'],
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
