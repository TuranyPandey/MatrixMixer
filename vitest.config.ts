import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@matrix-bridge/core': fileURLToPath(new URL('./core/src/index.ts', import.meta.url)) },
  },
  test: { include: ['core/test/**/*.test.ts', 'cli/test/**/*.test.ts'] },
});
