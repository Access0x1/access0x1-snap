import { readFileSync } from 'node:fs';

import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for the Access0x1 Snap unit tests.
 *
 * The Snap runtime (`snap.request`, `ethereum`) is not available under Node,
 * so tests mock the MetaMask provider. Pure logic (calldata decoding, USD
 * formatting, panel structure) is tested directly.
 */
export default defineConfig({
  plugins: [
    {
      // The Snaps build imports an .svg as its text; do the same under test.
      name: 'svg-as-text',
      enforce: 'pre',
      load(id) {
        return id.endsWith('.svg') ? `export default ${JSON.stringify(readFileSync(id, 'utf8'))};` : null;
      },
    },
  ],
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    globals: false,
  },
});
