/** Entry point: builds the server from environment variables and binds the port. */
import { createChamblerServer } from './app.js';

const server = createChamblerServer();
const port = await server.start();

console.log(`[chambler-server] listening on :${port} (ws + /health)`);
console.log(`[chambler-server] cors origins: ${server.config.corsOrigins.join(', ')}`);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`[chambler-server] ${signal} received, shutting down`);
  try {
    await server.stop();
    process.exit(0);
  } catch (error) {
    console.error('[chambler-server] shutdown failed', error);
    process.exit(1);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
