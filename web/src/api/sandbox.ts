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
  refusalKind: 'docker' | 'credential' | 'attached' | null;
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
