/**
 * Vitest setup: every test file gets its own snapshot directory so room
 * disposal saves never leak into the repository working tree.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.SNAPSHOT_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), 'chambler-test-saves-'));
