import type { BoardName, CardFrontmatterPatch, ProjectSnapshot } from './shared';

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

export function createCard(input: CreateCardBody): Promise<unknown> {
  return post('/api/cards', input);
}

export function patchCard(board: BoardName, id: string, patchBody: CardFrontmatterPatch): Promise<unknown> {
  return patch(`/api/cards/${board}/${id}`, patchBody);
}

export function moveCard(board: BoardName, id: string, toColumnSlug: string): Promise<unknown> {
  return post(`/api/cards/${board}/${id}/move`, { toColumnSlug });
}

export function archiveCard(board: BoardName, id: string): Promise<unknown> {
  return post(`/api/cards/${board}/${id}/archive`, {});
}
