import type { FastifyInstance } from 'fastify';
import { describe, expect, it, onTestFinished } from 'vitest';
import WebSocket from 'ws';
import { buildApp } from '../src/server/app.js';
import { CredentialStore } from '../src/server/auth/credentials.js';
import { DeviceStore } from '../src/server/auth/devices.js';
import { ProjectSession } from '../src/server/boards/session.js';
import { tempDir } from './helpers.js';

// The approval prompt has to REACH a screen someone is looking at, and a revoke has to reach the
// socket the revoked browser already holds. Both are about the WS channel, and neither is provable
// from HTTP alone — so this file opens real sockets with real per-device credentials.
//
// Not through `wsClient` in ./helpers: that opens /ws with no token, which only works because
// `testApp` injects an Authorization header. A test of per-device sockets has to present the
// device's own credential, so it builds the app itself.

const ADMIN = 'admin-token-for-socket-tests';
const admin = { authorization: `Bearer ${ADMIN}` };

interface Live {
  app: FastifyInstance;
  devices: DeviceStore;
  address: string;
}

async function live(): Promise<Live> {
  const session = new ProjectSession();
  const devices = DeviceStore.inMemory();
  const app = buildApp(session, { credentials: new CredentialStore(ADMIN, devices), devices, logger: false });
  const root = await tempDir();
  onTestFinished(async () => {
    await app.close();
    await session.close();
  });
  await app.inject({
    method: 'POST',
    url: '/api/project/scaffold',
    headers: admin,
    payload: { path: root, name: 'S', mode: 'brownfield' },
  });
  return { app, devices, address: await app.listen({ port: 0, host: '127.0.0.1' }) };
}

type Message = Record<string, unknown>;

interface Socket {
  messages: Message[];
  waitFor: (pred: (m: Message) => boolean) => Promise<Message>;
  waitUntil: (pred: (all: Message[]) => boolean) => Promise<void>;
  closed: Promise<{ code: number; reason: string }>;
  isOpen: () => boolean;
  close: () => void;
}

// The token rides in the query because a browser cannot set headers on a WebSocket handshake — which
// is also why the secret half is base64url.
function connect(address: string, token: string): Socket {
  const ws = new WebSocket(`${address.replace('http', 'ws')}/ws?token=${encodeURIComponent(token)}`);
  const messages: Record<string, unknown>[] = [];
  const waiters: Array<() => void> = [];
  ws.on('message', (data) => {
    messages.push(JSON.parse(data.toString()));
    for (const w of waiters) w();
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
  });
  onTestFinished(() => ws.close());
  const waitUntil = (pred: (all: Message[]) => boolean): Promise<void> =>
    new Promise((resolve) => {
      const check = (): boolean => {
        if (!pred(messages)) return false;
        resolve();
        return true;
      };
      if (!check()) waiters.push(check);
    });
  return {
    messages,
    closed,
    waitUntil,
    isOpen: () => ws.readyState === WebSocket.OPEN,
    close: () => ws.close(),
    waitFor: async (pred) => {
      await waitUntil((all) => all.some(pred));
      return messages.find(pred) as Message;
    },
  };
}

const opened = (s: Socket): Promise<unknown> => s.waitFor((m) => m.type === 'copilot:state');

describe('the approval prompt reaches a signed-in browser', () => {
  it('is pushed as soon as another browser asks, naming the label AND the address', async () => {
    const { app, devices, address } = await live();
    const mine = await devices.add('Firefox on the laptop', '192.168.0.16');
    const socket = connect(address, mine.token);
    await opened(socket);

    await app.inject({
      method: 'POST',
      url: '/auth/request',
      headers: { 'user-agent': 'Safari on the phone' },
      remoteAddress: '192.168.0.31',
    });

    const pushed = await socket.waitFor(
      (m) => m.type === 'signin:pending' && (m.pending as unknown[]).length === 1,
    );
    // The ADDRESS as well as the label, because the label is forgeable — `curl -H 'User-Agent: …'`
    // reproduces any header — and the address is the only thing on the prompt that narrows down
    // where the request actually came from.
    expect((pushed.pending as { label: string; address: string }[])[0]).toMatchObject({
      label: 'Safari on the phone',
      address: '192.168.0.31',
    });
  });

  it('is pushed on connect, so a browser opened afterwards still sees the prompt', async () => {
    // Otherwise the only person who could allow it is the one who happened to be watching the moment
    // it arrived.
    const { app, devices, address } = await live();
    const mine = await devices.add('Firefox', '127.0.0.1');
    await app.inject({ method: 'POST', url: '/auth/request', headers: { 'user-agent': 'Safari' } });

    const socket = connect(address, mine.token);

    const first = await socket.waitFor((m) => m.type === 'signin:pending');
    expect((first.pending as { label: string }[])[0].label).toBe('Safari');
  });

  it('is pushed again, empty, once the request is dealt with', async () => {
    const { app, devices, address } = await live();
    const mine = await devices.add('Firefox', '127.0.0.1');
    const socket = connect(address, mine.token);
    await opened(socket);
    const { id } = (
      await app.inject({ method: 'POST', url: '/auth/request', headers: { 'user-agent': 'Safari' } })
    ).json();
    await socket.waitFor((m) => m.type === 'signin:pending' && (m.pending as unknown[]).length === 1);

    await app.inject({
      method: 'POST',
      url: `/api/signin/refuse/${id}`,
      headers: { authorization: `Bearer ${mine.token}` },
    });

    // The SEQUENCE, not "a message with an empty list". The push sent on connect is itself empty, so
    // waiting for one of those matches instantly and proves nothing — the assertion has to be that a
    // THIRD push arrived and that it is the empty one.
    //
    // The prompt has to go away by itself: a stale prompt is one a person clicks, and Allow on a stale
    // prompt is the failure this whole path is defended against.
    await socket.waitUntil((all) => all.filter((m) => m.type === 'signin:pending').length >= 3);
    const pushes = socket.messages
      .filter((m) => m.type === 'signin:pending')
      .map((m) => (m.pending as unknown[]).length);
    expect(pushes).toEqual([0, 1, 0]);
  });
});

describe('revoking a device', () => {
  // WITHOUT THIS, revocation is decorative for the surface that matters most. The next HTTP request
  // 401s, but the socket that device already holds keeps streaming the board — and that socket carries
  // the copilot channel, whose tools write files with no approval step.
  it('closes that device’s socket and leaves the others open', async () => {
    const { app, devices, address } = await live();
    const gone = await devices.add('Phone', '192.168.0.31');
    const kept = await devices.add('Laptop', '192.168.0.16');
    const doomed = connect(address, gone.token);
    const survivor = connect(address, kept.token);
    await Promise.all([opened(doomed), opened(survivor)]);

    await app.inject({
      method: 'DELETE',
      url: `/api/signin/devices/${gone.id}`,
      headers: { authorization: `Bearer ${kept.token}` },
    });

    // 1008 is "policy violation". The client cannot read the HTTP status of a failed handshake — a
    // 401'd upgrade arrives as 1006, indistinguishable from "the server is not running" — so the close
    // code is the only channel there is for saying WHY.
    expect(await doomed.closed).toMatchObject({ code: 1008 });
    expect(survivor.isOpen()).toBe(true);
  });

  it('signing everything out closes every socket', async () => {
    const { app, devices, address } = await live();
    const first = await devices.add('Phone', '192.168.0.31');
    const second = await devices.add('Laptop', '192.168.0.16');
    const a = connect(address, first.token);
    const b = connect(address, second.token);
    await Promise.all([opened(a), opened(b)]);

    await app.inject({
      method: 'POST',
      url: '/api/signin/clear',
      headers: { authorization: `Bearer ${second.token}` },
    });

    expect((await a.closed).code).toBe(1008);
    expect((await b.closed).code).toBe(1008);
  });

  it('does not close a socket held by the admin token, which belongs to no device', async () => {
    // The admin token cannot be revoked — `rm` on the file and a restart is its only rotation, which
    // is why it is no longer printed anywhere. A revoke that closed it would be closing a credential
    // it did not revoke.
    const { app, devices, address } = await live();
    const gone = await devices.add('Phone', '192.168.0.31');
    const bystander = connect(address, ADMIN);
    const doomed = connect(address, gone.token);
    await Promise.all([opened(bystander), opened(doomed)]);

    await app.inject({ method: 'DELETE', url: `/api/signin/devices/${gone.id}`, headers: admin });

    expect((await doomed.closed).code).toBe(1008);
    expect(bystander.isOpen()).toBe(true);
  });
});
