import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { logger } from './logger';

const wss = new WebSocketServer({ noServer: true });

// Map of presentationId -> Set of connected WebSocket clients
const sessions = new Map<string, Set<WebSocket>>();

wss.on('connection', (ws: WebSocket, req: { url?: string }) => {
  const match = req.url?.match(/\/api\/ws\/presentations\/([^/?]+)/);
  if (!match) {
    ws.close(1008, 'Invalid path');
    return;
  }

  const presentationId = match[1];

  if (!sessions.has(presentationId)) {
    sessions.set(presentationId, new Set());
  }
  sessions.get(presentationId)!.add(ws);

  logger.info({ presentationId }, 'WebSocket client connected');

  ws.on('message', (data) => {
    // Presenter slide updates go through PATCH /presentations/:id/slide (REST),
    // which handles maxRevealedSlide logic and calls broadcastSlideChange.
    // Raw WS messages from clients are intentionally ignored here.
    logger.debug({ data: data.toString(), presentationId }, 'WS message received (ignored)');
  });

  ws.on('close', () => {
    const clients = sessions.get(presentationId);
    if (clients) {
      clients.delete(ws);
      if (clients.size === 0) {
        sessions.delete(presentationId);
      }
    }
    logger.info({ presentationId }, 'WebSocket client disconnected');
  });

  ws.on('error', (err) => {
    logger.warn({ err, presentationId }, 'WebSocket error');
  });
});

export function setupWebSocketServer(server: Server): void {
  server.on('upgrade', (req, socket, head) => {
    if (req.url?.match(/^\/api\/ws\/presentations\//)) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } else {
      socket.destroy();
    }
  });
}

export function broadcastSlideChange(presentationId: string, slideIndex: number, maxRevealedSlide: number, sender?: WebSocket): void {
  const clients = sessions.get(presentationId);
  if (!clients) return;

  const message = JSON.stringify({ type: 'slide', slideIndex, maxRevealedSlide });
  for (const client of clients) {
    if (client !== sender && client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

export function getViewerCount(presentationId: string): number {
  return sessions.get(presentationId)?.size ?? 0;
}
