/**
 * The pack owns its test project so it can be validated without touching the
 * root workspace. `globals: true` keeps the suite free of bare imports (the pack
 * has no node_modules of its own); `@chambler/modkit` resolves to the validator
 * sources so tests never depend on a prior build.
 */
import { fileURLToPath } from 'node:url';

const modkitSrc = fileURLToPath(new URL('../../packages/modkit/src/index.ts', import.meta.url));

export default {
  resolve: {
    alias: {
      '@chambler/modkit': modkitSrc,
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    reporters: ['default'],
  },
};
