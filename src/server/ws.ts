import websocket from '@fastify/websocket';
import type { FastifyInstance, preValidationHookHandler } from 'fastify';
import { bearerToken } from './auth.js';
import type { AppCtx, WsClient } from './route-context.js';

// Fan-out to every connected browser. A send on a closed socket is swallowed: a client that
// vanished mid-broadcast must not abort delivery to the others.
export function createBroadcaster(): {
  clients: Set<WsClient>;
  broadcast: (msg: unknown) => void;
  closeDevice: (device: string | null) => number;
} {
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
  // Hangs up on a revoked device. Without this, revocation stops the next HTTP request and leaves the
  // socket that device already holds streaming the board — and that socket carries the copilot
  // channel, whose tools write files. `null` closes every one of them, for Sign everything out.
  //
  // The set is not mutated here: each socket's own 'close' handler removes it, which is the one place
  // that knows the socket is really gone.
  const closeDevice = (device: string | null): number => {
    let closed = 0;
    for (const c of clients) {
      if (device !== null && c.device !== device) continue;
      try {
        c.close?.();
        closed += 1;
      } catch {
        /* already gone */
      }
    }
    return closed;
  };
  return { clients, broadcast, closeDevice };
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
      // `||`, not `??`: an empty `?token=` is a missing token, not a supplied one, and with `??`
      // it shadowed a perfectly good Authorization header.
      const cred = ctx.credentials.verify(token || bearerToken(req.headers.authorization));
      if (cred?.scope !== 'admin') return reply.code(401).send({ error: 'Unauthorized' });
      // Stashed for the handler below, which needs to know WHICH device holds this socket so a revoke
      // can hang up on exactly that one. Re-verifying there would be a second lookup answering a
      // question already answered.
      req.credential = cred;
    };

    root.get('/ws', { websocket: true, preValidation: authenticate }, (socket, req) => {
      // A wrapper rather than the socket itself, so the registry carries the device this connection
      // belongs to. The set is keyed by identity, and this object is created once per connection, so
      // `delete` on close still finds it.
      const client: WsClient = {
        send: (data) => socket.send(data),
        // 1008 is "policy violation", which is what a revoked credential is. The client reads the code
        // to tell this apart from a server that went away — it cannot read the status of a failed
        // handshake, so the close code is the only channel there is.
        close: () => socket.close(1008, 'signed out'),
        ...(req.credential?.device ? { device: req.credential.device } : {}),
      };
      clients.add(client);
      const send = (snapshot: unknown): void => {
        try {
          client.send(JSON.stringify({ type: 'snapshot', snapshot }));
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
      // The sign-in requests waiting for a decision, pushed on connect as well as on change: a browser
      // that opens after a request was made must still see the prompt, or the person who has to allow
      // it would have to have been watching at the moment it arrived.
      client.send(JSON.stringify({ type: 'signin:pending', pending: ctx.signin.list() }));
      if (ctx.session.isOpen)
        void sendHistory(client).catch((err) => log.warn({ err }, 'initial chat history failed'));
      const unsubscribe = ctx.session.subscribe(send);
      socket.on('message', (raw: Buffer) => onMessage(raw.toString('utf8')));
      socket.on('close', () => {
        unsubscribe();
        clients.delete(client);
      });
    });
  });
}
