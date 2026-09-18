// The open project: what is open, its config, and the two ways one comes into existence.

import type { ProjectConfig, ProjectSnapshot, ScaffoldMode } from '../shared';
import { patch, post, request } from './http';

export interface ProjectRef {
  path: string;
  name: string;
}

export async function getState(): Promise<{ open: boolean; snapshot?: ProjectSnapshot }> {
  return (await request('/api/state', {}, { fallback: 'Failed to read the open project' })).json();
}

export function patchConfig(body: Partial<ProjectConfig>): Promise<ProjectConfig> {
  return patch<ProjectConfig>('/api/config', body);
}

export async function listProjects(root?: string): Promise<ProjectRef[]> {
  const q = root ? `?root=${encodeURIComponent(root)}` : '';
  return (await request(`/api/projects${q}`, {}, { fallback: 'Failed to list projects' })).json();
}

export function openProject(path: string): Promise<{ snapshot: ProjectSnapshot }> {
  return post('/api/project/open', { path });
}

// Declared in `../shared` with the other wire types, because the wizard's state carries one and that
// file cannot import this one. Re-exported so every caller and the barrel keep their import path.
export type { ScaffoldMode } from '../shared';

export function scaffoldProject(
  path: string,
  name: string,
  mode: ScaffoldMode = 'greenfield',
): Promise<{ snapshot: ProjectSnapshot }> {
  return post('/api/project/scaffold', { path, name, mode });
}

// DELETING A PROJECT. `name` is the folder's last segment, typed by the user, and it is re-checked on
// the server — the dialog's own `requireText` is the same question asked where the answer is convenient,
// not where it is binding.
export function deleteProject(path: string, name: string): Promise<{ removed: string }> {
  return post('/api/project/delete', { path, name });
}
