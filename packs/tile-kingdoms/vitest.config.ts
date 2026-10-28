/**
 * The pack owns its test project so it can be validated without touching the
 * root workspace. `globals: true` keeps the suite free of bare imports (the pack
 * has no node_modules of its own); tests are pure TS + node:fs, no engine code.
 */
export default {
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    reporters: ['default'],
  },
};
