// The sandbox agents run inside, and the agent server behind it.

import { post, request } from './http';

// What the OS enforces on agents, and the two ways to change it. `agentRefusal` is computed on the
// server, by the SAME function the dispatch gate calls — so the panel cannot describe a rule the
// gate does not apply. Two of those diverged once already.
export interface SandboxState {
  ok: boolean;
  profile?: string;
  reason?: string;
  backend: 'managed' | 'attached';
  attachedUrl?: string;
  agentRefusal: string | null;
  // WHICH cause, so the UI can title the refusal without parsing the sentence. There are now two ways
  // to be unable to run agents and they need different headings: "Docker is not ready" is a lie when
  // the daemon is fine and the box is holding a credential that has been replaced on the host.
  //
  // A discriminator rather than a second sentence: the sentence stays the server's, computed by the
  // gate itself, and this only says which kind of thing it is about. `null` exactly when
  // `agentRefusal` is null.
  refusalKind: 'docker' | 'credential' | 'attached' | 'backend' | null;
  // WOULD BUILDING THE AGENT IMAGE FIX THIS? Set only for the one fault a build addresses, so the panel
  // never offers to build against a daemon that is not running. Absent otherwise, including when the
  // sandbox is fine.
  buildable?: true;
  // WHAT ALREADY WENT WRONG, as distinct from what is wrong NOW — and it does not gate anything.
  //
  // Every other field here answers "may an agent start", which is a question about the present and is
  // enforced. This answers "did the last attempts die before reaching a model", which is a question
  // about the past, and it is REPORTED ONLY. The distinction is the whole design and it is not
  // stylistic: a gate keyed on history cannot be cleared, because the run that would clear it is the
  // run the gate refuses. That deadlock has already been built once in this codebase — the
  // infrastructure streak, which could never break its own streak — and this is the same shape.
  //
  // The evidence is the loop's OWN: runs stamped `fault: infrastructure`, the same records auto-pilot
  // read when it stopped. Deriving the light from them rather than from a fresh probe means the light
  // cannot disagree with the loop, and needs nothing to be true that the loop did not already observe.
  //
  // Absent when the last runs were healthy, or when there are none.
  recentFailure?: {
    runs: number; // how many in a row
    note: string; // what the harness actually said, from the record — never reworded here
    at: string; // when the most recent one started, ISO
  };
}

export async function getSandbox(): Promise<SandboxState> {
  return (await request('/api/sandbox', {}, { fallback: 'Failed to read the sandbox state' })).json();
}

export function restartOpencodeServer(): Promise<{ ok: true; url: string }> {
  return post<{ ok: true; url: string }>('/api/opencode/restart', {});
}

export function takeOverOpencodeServer(): Promise<{ ok: true; url: string }> {
  return post<{ ok: true; url: string }>('/api/opencode/takeover', {});
}

// Throw this project's agent boxes away so the next turn builds new ones. The IMAGE is untouched —
// that is a build, it takes minutes, and it is not what is wrong when a box has drifted from what it
// should be. `removed` is how many containers actually went, so the panel can say nothing was there
// rather than implying it fixed something.
export function rebuildBoxes(): Promise<{ ok: true; removed: number }> {
  return post<{ ok: true; removed: number }>('/api/boxes/rebuild', {});
}

// BUILD THE AGENT IMAGE. Minutes, and its progress arrives over the socket as `box:build` frames rather
// than in this response — a request that shows nothing for minutes is indistinguishable from one that
// has hung. `already` is true when the image turned up between the refusal and the click.
export function buildAgentImage(): Promise<{ ok: true; already: boolean }> {
  return post<{ ok: true; already: boolean }>('/api/boxes/build', {});
}
