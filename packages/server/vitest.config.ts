import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 15_000,
    hookTimeout: 20_000,
    // The integration suite boots one real server on a fixed port; run files
    // sequentially so tests never fight over it.
    fileParallelism: false,
    // Colyseus ships @pm2/io, which writes to `process.send` when it exists
    // (vitest's fork pool owns that channel). Worker threads have no IPC
    // channel, so the pool stays clean.
    pool: 'threads',
    setupFiles: ['./src/testSetup.ts'],
  },
});
