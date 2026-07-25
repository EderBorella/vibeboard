import type {
  ArchivedCard,
  BoardName,
  Card,
  CardFrontmatterPatch,
  ProjectConfig,
  ProjectSnapshot,
} from './shared';

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

export interface ProjectRef {
  path: string;
  name: string;
}

export async function getState(): Promise<{ open: boolean; snapshot?: ProjectSnapshot }> {
  return (await fetch('/api/state')).json();
}

export function patchConfig(body: Partial<ProjectConfig>): Promise<ProjectConfig> {
  return patch<ProjectConfig>('/api/config', body);
}

export interface ModelCaps {
  toolCall?: boolean;
  reasoning?: boolean;
  vision?: boolean;
  attachment?: boolean;
}

export interface ModelOption {
  id: string;
  free: boolean;
  name?: string;
  promptPerM?: number;
  completionPerM?: number;
  contextLength?: number;
  outputLimit?: number;
  caps?: ModelCaps;
}

export interface ModelStatus {
  up: boolean;
  uptime?: number;
  endpoints: number;
}

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

// greenfield = a brand-new folder (full scaffold + sample cards).
// brownfield = adopt an existing repo: add the cockpit alongside what's already there,
// appending only pointers to CLAUDE.md / AGENTS.md and creating no sample cards.
export type ScaffoldMode = 'greenfield' | 'brownfield';

export function scaffoldProject(
  path: string,
  name: string,
  mode: ScaffoldMode = 'greenfield',
): Promise<{ snapshot: ProjectSnapshot }> {
  return post('/api/project/scaffold', { path, name, mode });
}

interface CreateCardBody {
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

// Position a card within a column, or move it into another one, in a single call. `beforeId`
// is the card to insert in front of; null means the end. The server renumbers `order`.
export function placeCard(
  board: BoardName,
  id: string,
  toColumnSlug: string,
  beforeId: string | null,
): Promise<unknown> {
  return post(`/api/cards/${board}/${id}/place`, { toColumnSlug, beforeId });
}

export function archiveCard(board: BoardName, id: string): Promise<unknown> {
  return post(`/api/cards/${board}/${id}/archive`, {});
}

// Fetched on demand: the archive only grows, so it rides outside the snapshot. The snapshot's
// archivedCounts tell the UI when this is worth calling again.
export async function listArchive(board: BoardName): Promise<ArchivedCard[]> {
  const res = await fetch(`/api/archive/${board}`);
  if (!res.ok) throw new Error('Failed to load the archive');
  return (await res.json()).cards as ArchivedCard[];
}

// Omit toColumnSlug to land in the column the card was archived from (or the board's first
// column, if that one no longer exists).
export function restoreCard(board: BoardName, id: string, toColumnSlug?: string): Promise<Card> {
  return post<Card>(`/api/cards/${board}/${id}/restore`, toColumnSlug ? { toColumnSlug } : {});
}

// ---- Project Control -------------------------------------------------------

export type ControlCategory = 'instructions' | 'skills' | 'docs' | 'resources';

export interface ControlFile {
  path: string;
  name: string;
  category: ControlCategory;
  managed: boolean;
  deletable: boolean;
}

export interface ControlGroup {
  key: ControlCategory;
  label: string;
  files: ControlFile[];
}

export interface ResourceLink {
  title: string;
  url: string;
  note?: string;
}

export async function listControlFiles(): Promise<ControlGroup[]> {
  const res = await fetch('/api/control/files');
  if (!res.ok) throw new Error('Failed to load control files');
  return (await res.json()).groups as ControlGroup[];
}

export async function getControlFile(path: string): Promise<ControlFile & { content: string }> {
  const res = await fetch(`/api/control/file?path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to load file');
  return res.json();
}

export async function putControlFile(path: string, content: string): Promise<void> {
  const res = await fetch('/api/control/file', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, content }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to save file');
}

// Create with a server-assigned default name ("New doc", "New doc 2", …). The UI then renames
// it in place, so no browser dialog is involved and the file exists either way.
export function createControlFile(category: ControlCategory): Promise<ControlFile> {
  return post<ControlFile>('/api/control/create', { category });
}

export function renameControlFile(path: string, name: string): Promise<ControlFile> {
  return post<ControlFile>('/api/control/rename', { path, name });
}

export async function deleteControlFile(path: string): Promise<void> {
  const res = await fetch(`/api/control/file?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to delete file');
}

export async function getResources(): Promise<ResourceLink[]> {
  const res = await fetch('/api/control/resources');
  if (!res.ok) throw new Error('Failed to load resources');
  return (await res.json()).links as ResourceLink[];
}

export async function putResources(links: ResourceLink[]): Promise<void> {
  const res = await fetch('/api/control/resources', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ links }),
  });
  if (!res.ok) throw new Error('Failed to save resources');
}
