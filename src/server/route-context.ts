import type { FastifyReply } from 'fastify';
import type { ProjectConfig } from '../core/types.js';
import type { ChatStore } from '../store/chat-store.js';
import type { CredentialStore } from './auth/credentials.js';
import type { DeviceStore } from './auth/devices.js';
import type { PendingRequests } from './auth/signin.js';
import type { AutopilotRuntime } from './autopilot/autopilot-runtime.js';
import type { ServiceProcess } from './autopilot/service-process.js';
import type { ProjectSession } from './boards/session.js';
import type { BoxService } from './boxes/box-service.js';
import type { LiveSandbox } from './boxes/sandbox.js';
import type { CopilotSession } from './copilot/copilot.js';
import type { CopilotAuthority } from './copilot/copilot-authority.js';
import type { Log } from './logging.js';
import type { AgentRunner } from './runs/agent-runner.js';

// The shared surface every route group and the WS layer needs. Passed explicitly rather
// than closed over, so each route module is a plain function of its context and can be
// read (and tested) without the rest of the app.
export interface WsClient {
  send: (data: string) => void;
  // Which signed-in device holds this socket, and how to hang up on it. Both absent for a client
  // authenticated by the admin token, which belongs to no device and cannot be revoked — `rm` on the
  // file and a restart is that credential's only rotation, which is why it is no longer printed.
  device?: string;
  close?: () => void;
}

export interface AppCtx {
  session: ProjectSession;
  copilot: CopilotSession;
  // The copilot's API credential, when a person has authorised it. Held here rather than on the
  // session because it is authority, and authority is the composition root's to hand out.
  copilotAuthority: CopilotAuthority;
  chats: ChatStore;
  // Skill runs. Separate from `copilot` deliberately: the chat is one conversation at a time, a run
  // is one prompt in and one report out, and neither should be able to block the other.
  runner: AgentRunner;
  // Auto-pilot's state and the three stops. Everything that refuses an action while a project is
  // halted or under auto-pilot asks this rather than reading the file itself.
  autopilot: AutopilotRuntime;
  // The loop's own process. Separate from `autopilot` above because they own different halves of one
  // file: the runtime writes the state and the stops, this spawns and supervises the process that
  // writes the counters (decision 20).
  service: ServiceProcess;
  // Who is allowed to call what. Held on the context because both the HTTP boundary and the
  // websocket need to verify against the same store, and a run's credential is minted here when
  // it is dispatched and revoked when it settles.
  credentials: CredentialStore;
  // The browsers that have signed in, and the requests waiting to. Held here for the same reason as
  // `credentials`: the HTTP boundary, the socket handshake and the sign-in routes all have to consult
  // one store, and `devices.empty` is what decides whether the unauthenticated claim is open.
  devices: DeviceStore;
  signin: PendingRequests;
  // Hangs up on a revoked device's sockets — `null` means every socket, for Sign everything out.
  // Answers how many it closed. Lives on the context because revocation happens in a route and the
  // socket registry belongs to the WS layer, and neither should have to reach into the other.
  closeDevice: (device: string | null) => number;
  // Whether agents are confined, and to what. A FUNCTION, and the comment it replaces is why: it used
  // to say the status "cannot change while the process runs, so a function would only invite callers to
  // wonder whether it might". It can — an image can be built or removed under a running server — and
  // because this same value gates every dispatch, believing otherwise let a run start against an image
  // that was no longer there. Live, TTL-cached; see `liveSandbox`.
  sandbox: LiveSandbox;
  // Where agents run. Optional because a test about something else neither has docker nor needs it.
  boxes?: BoxService;
  broadcast: (msg: unknown) => void;
  // Route handlers already have `request.log`. This is for everything that happens with no request to
  // hang off: the watcher, the WS channel, a run settling long after its dispatch was answered.
  log: Log;
}

export const today = (): string => new Date().toISOString().slice(0, 10);

// Full precision, unlike `created` — the archive drawer orders by it, and a day-granular
// stamp would leave everything archived today in an arbitrary order.
export const nowIso = (): string => new Date().toISOString();

// A type predicate, not a boolean: past this guard `root` and `config` are known to be set, so
// handlers read them directly instead of asserting non-null at every use.
export function ensureOpen(
  session: ProjectSession,
  reply: FastifyReply,
): session is ProjectSession & { root: string; config: ProjectConfig } {
  if (!session.root || !session.config) {
    reply.code(409).send({ error: 'No project open' });
    return false;
  }
  return true;
}
