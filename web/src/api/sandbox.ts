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
