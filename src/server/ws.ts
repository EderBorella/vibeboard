import websocket from '@fastify/websocket';
import type { FastifyInstance, preValidationHookHandler } from 'fastify';
import { bearerToken } from './auth.js';
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
    // Admin only, and refused at the handshake rather than closed after it, so an unauthorised
    // client never holds an open socket at all. Checked here rather than by the /api preHandler,
    // which Fastify's encapsulation deliberately keeps out of this scope — and it has to be
    // checked somewhere, because this socket carries the copilot channel, whose tools write files
    // with no approval step. Locking the HTTP surface while leaving it open would secure nothing.
    //
    // The token arrives as a query parameter because a browser cannot set headers on a WebSocket
    // handshake.
    const authenticate: preValidationHookHandler = async (req, reply) => {
      const { token } = req.query as { token?: string };
      const cred = ctx.credentials.verify(token ?? bearerToken(req.headers.authorization));
      if (cred?.scope !== 'admin') return reply.code(401).send({ error: 'Unauthorized' });
    };

    root.get('/ws', { websocket: true, preValidation: authenticate }, (socket) => {
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
