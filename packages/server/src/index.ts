import http from 'node:http';
import express from 'express';
import { Server } from 'colyseus';

const PORT = Number(process.env.PORT ?? 3001);

const app = express();

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'chambler-server' });
});

// Oda mantigi YOK (B1 gorevine ait). Sunucu su an sadece yukarida duruyor.
const httpServer = http.createServer(app);
const gameServer = new Server({ server: httpServer });

void gameServer.listen(PORT).then(() => {
  console.log(`[chambler-server] listening on :${PORT} (ws + /health)`);
});
