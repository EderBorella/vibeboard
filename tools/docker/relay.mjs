#!/usr/bin/env node
// Maps the address VibeBoard tells agents to call onto the API socket mounted into this box.
//
// `apiBase()` hands agents `http://127.0.0.1:<port>`. Inside a container that is the container's own
// loopback, so without this there is nothing there and every instruction we give an agent about
// calling the API points at nothing. With it, the address we advertise is true in here too.
//
// The upstream socket is connected PER CONNECTION rather than once at startup. The socket's directory
// is what is bind-mounted, so when VibeBoard restarts and recreates the socket the new one appears at
// the same path — connecting late is what lets a long-lived box survive a server restart.
import { connect, createServer } from 'node:net';

const PORT = Number(process.env.VIBEBOARD_PORT ?? 4610);
const SOCKET = process.env.VIBEBOARD_API_SOCKET ?? '/run/vibeboard/api.sock';

createServer((client) => {
  const upstream = connect(SOCKET);
  client.pipe(upstream);
  upstream.pipe(client);
  // Either side going away takes the other with it. Without this a failed upstream connect leaves the
  // agent's request hanging until its own timeout, which reads as "the API is slow" rather than "the
  // socket is not mounted".
  upstream.on('error', () => client.destroy());
  client.on('error', () => upstream.destroy());
}).listen(PORT, '127.0.0.1', () => {
  console.log(`[vb-relay] 127.0.0.1:${PORT} -> ${SOCKET}`);
});
