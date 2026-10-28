#!/usr/bin/env node
import { resolve } from 'node:path';
import { validatePack } from './validate.js';

/**
 * Usage: node dist/cli.js <packDir>
 * Prints a human-readable error list and exits with:
 *   0 = pack valid
 *   1 = pack invalid
 *   2 = usage error
 */
async function main(): Promise<void> {
  const packDir = process.argv[2];
  if (!packDir) {
    process.stderr.write('Usage: modkit <packDir>\n');
    process.exitCode = 2;
    return;
  }

  const dir = resolve(packDir);
  const result = await validatePack(dir);

  if (result.ok) {
    const { manifest } = result;
    process.stdout.write(
      `OK: pack "${manifest.packId}" v${manifest.version} (schemaVersion ${manifest.schemaVersion})\n` +
        `    name: ${manifest.name}\n` +
        `    players: ${manifest.players.min}-${manifest.players.max}, ` +
        `assets: ${Object.keys(manifest.assets).length}, ` +
        `components: ${manifest.components.length}, ` +
        `decks: ${manifest.decks?.length ?? 0}\n`,
    );
    process.exitCode = 0;
    return;
  }

  process.stdout.write(`INVALID: pack at ${dir}\n`);
  for (const error of result.errors) {
    const where = error.field ?? error.path ?? '';
    process.stdout.write(`  [${error.code}]${where ? ` ${where}` : ''}: ${error.message}\n`);
  }
  process.stdout.write(`Total errors: ${result.errors.length}\n`);
  process.exitCode = 1;
}

await main();
