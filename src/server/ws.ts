import websocket from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';
import type { AppCtx, WsClient } from './route-context.js';

// Fan-out to every connected browser. A send on a closed socket is swallowed: a client that
// vanished mid-broadcast must not abort delivery to the others.
export function createBroadcaster(): { clients: Set<WsClient>; broadcast: (msg: unknown) => void } {
  const clients = new Set<WsClient>();
  const broadcast = (msg: unknown): void => {
    const data = JSON.stringify(msg);
    for (const c of clients) {
      try {
        c.send(data);
      } catch {
        /* closed */
      }
    }
  };
  return { clients, broadcast };
}

// One /ws endpoint carries BOTH the board snapshot stream and the copilot channel, so a
// client needs a single socket for everything.
//
// Registration is deliberately synchronous — `register` queues the plugin and Fastify boots
// it on ready(). Awaiting it here instead would move the /ws registration into a later
// microtask, after buildApp has already returned, and race the first inject()'s ready().
export function registerWs(
  app: FastifyInstance,
  ctx: AppCtx,
  clients: Set<WsClient>,
  onMessage: (raw: string) => void,
  sendHistory: (target?: WsClient) => Promise<void>,
): void {
  app.register(websocket);
  const log = ctx.log.child({ component: 'ws' });

  app.register(async (root) => {
    root.get('/ws', { websocket: true }, (socket) => {
      clients.add(socket);
      const send = (snapshot: unknown): void => {
        try {
          socket.send(JSON.stringify({ type: 'snapshot', snapshot }));
        } catch {
          /* socket closed mid-send */
        }
      };
      // Both of these are a new client's FIRST payload. Failing here leaves that browser showing an
      // empty board or an empty chat with no error anywhere, and no second attempt: nothing retries
      // a connect.
      if (ctx.session.isOpen)
        void ctx.session
          .snapshot()
          .then(send)
          .catch((err) => log.warn({ err }, 'initial snapshot failed'));
      socket.send(JSON.stringify({ type: 'copilot:state', state: ctx.copilot.state }));
      if (ctx.session.isOpen)
        void sendHistory(socket).catch((err) => log.warn({ err }, 'initial chat history failed'));
      const unsubscribe = ctx.session.subscribe(send);
      socket.on('message', (raw: Buffer) => onMessage(raw.toString('utf8')));
      socket.on('close', () => {
        unsubscribe();
        clients.delete(socket);
      });
    });
  });
}
