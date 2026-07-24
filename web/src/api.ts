import type { BoardName, Card, CardFrontmatterPatch, ProjectConfig, ProjectSnapshot } from './shared';

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.json() as Promise<T>;
}

async function patch<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.json() as Promise<T>;
}

export interface ProjectRef { path: string; name: string }

export async function getState(): Promise<{ open: boolean; snapshot?: ProjectSnapshot }> {
  return (await fetch('/api/state')).json();
}

export async function getConfig(): Promise<ProjectConfig> {
  return (await fetch('/api/config')).json();
}

export function patchConfig(body: Partial<ProjectConfig>): Promise<ProjectConfig> {
  return patch<ProjectConfig>('/api/config', body);
}

export interface ModelOption {
  id: string;
  free: boolean;
  promptPerM?: number;
  completionPerM?: number;
  contextLength?: number;
}

export interface ModelStatus { up: boolean; uptime?: number; endpoints: number }

export async function listModels(backend: string): Promise<ModelOption[]> {
  return (await fetch(`/api/models?backend=${encodeURIComponent(backend)}`)).json();
}

export async function getModelStatus(id: string): Promise<ModelStatus | null> {
  return (await fetch(`/api/model-status?id=${encodeURIComponent(id)}`)).json().then((r) => r.status);
}

export async function listProjects(root?: string): Promise<ProjectRef[]> {
  const q = root ? `?root=${encodeURIComponent(root)}` : '';
  return (await fetch(`/api/projects${q}`)).json();
}

export function openProject(path: string): Promise<{ snapshot: ProjectSnapshot }> {
  return post('/api/project/open', { path });
}

export function scaffoldProject(path: string, name: string): Promise<{ snapshot: ProjectSnapshot }> {
  return post('/api/project/scaffold', { path, name, mode: 'greenfield' });
}

export interface CreateCardBody {
  board: BoardName;
  columnSlug: string;
  title: string;
  description?: string;
  tags?: string[];
  links?: string[];
  group?: string;
  body?: string;
}

export function createCard(input: CreateCardBody): Promise<Card> {
  return post('/api/cards', input);
}

export function patchCard(board: BoardName, id: string, patchBody: CardFrontmatterPatch): Promise<unknown> {
  return patch(`/api/cards/${board}/${id}`, patchBody);
}

export async function getRaw(board: BoardName, id: string): Promise<string> {
  const res = await fetch(`/api/cards/${board}/${id}/raw`);
  if (!res.ok) throw new Error('Failed to load card file');
  return (await res.json()).raw as string;
}

export async function putRaw(board: BoardName, id: string, raw: string): Promise<void> {
  const res = await fetch(`/api/cards/${board}/${id}/raw`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) throw new Error('Failed to save card file');
}

// Symmetric link reconcile — updates both sides. The single path for link changes.
export async function setLinks(board: BoardName, id: string, links: string[]): Promise<void> {
  const res = await fetch(`/api/cards/${board}/${id}/links`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ links }),
  });
  if (!res.ok) throw new Error('Failed to update links');
}

export function moveCard(board: BoardName, id: string, toColumnSlug: string): Promise<unknown> {
  return post(`/api/cards/${board}/${id}/move`, { toColumnSlug });
}

export function archiveCard(board: BoardName, id: string): Promise<unknown> {
  return post(`/api/cards/${board}/${id}/archive`, {});
}
