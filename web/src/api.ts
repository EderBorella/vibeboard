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

async function put<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'PUT',
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

// ---- Explorer --------------------------------------------------------------
// The project as it is on disk. No category and no allow-list, unlike the control files above —
// the only boundary is the project root, enforced server-side.

export interface FsNode {
  path: string; // root-relative POSIX
  name: string;
  kind: 'file' | 'dir' | 'other';
  size?: number;
  symlink?: true;
  target?: string;
  escapes?: true; // points outside the project: shown so it can be removed, never opened
}

export interface DirListing {
  path: string;
  parent: string | null;
  entries: FsNode[];
  truncated?: number; // entries the server did not return
}

// Three outcomes rather than a boolean: what the pane says differs, so the difference is data.
export type FileRead =
  | { kind: 'text'; path: string; name: string; size: number; content: string }
  | { kind: 'binary'; path: string; name: string; size: number }
  | { kind: 'too-large'; path: string; name: string; size: number };

export async function listDir(path: string): Promise<DirListing> {
  const res = await fetch(`/api/explorer/list?path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to list folder');
  return res.json();
}

export async function readFsFile(path: string): Promise<FileRead> {
  const res = await fetch(`/api/explorer/file?path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to load file');
  return res.json();
}

export async function putFsFile(path: string, content: string): Promise<void> {
  const res = await fetch('/api/explorer/file', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, content }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to save file');
}

// Created with a server-assigned default name ("Untitled.md", "Untitled 2.md", …), which the tree
// then renames in place. The client never builds a path — same rule as the control routes.
export function createFsNode(parent: string, kind: 'file' | 'dir'): Promise<FsNode> {
  return post<FsNode>('/api/explorer/create', { parent, kind });
}

// `name` is a literal basename, not a path: a rename must not be able to relocate anything.
export function renameFsNode(path: string, name: string): Promise<FsNode> {
  return post<FsNode>('/api/explorer/rename', { path, name });
}

// `to` is the destination folder; the name comes along unchanged.
export function moveFsNode(path: string, to: string): Promise<FsNode> {
  return post<FsNode>('/api/explorer/move', { path, to });
}

// --- Skills ---------------------------------------------------------------
// Mirrors src/core/skills.ts. A skill carries no backend, model, effort or mode — those are
// chosen per dispatch, so every skill works on every backend.

export interface Skill {
  slug: string;
  path: string;
  name: string;
  description: string;
  boards: BoardName[];
  columns: string[];
  prompt: string;
}

// A skill file that failed validation: absent from the rail, reported with its reason so it is
// distinguishable from a skill nobody wrote.
export interface InvalidSkill {
  slug: string;
  path: string;
  reason: string;
}

export interface SkillCatalogue {
  skills: Skill[];
  invalid: InvalidSkill[];
}

export async function listSkills(): Promise<SkillCatalogue> {
  const res = await fetch('/api/skills');
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.json() as Promise<SkillCatalogue>;
}

// --- Runs -----------------------------------------------------------------
// Mirrors src/core/runs.ts. Frontmatter is VibeBoard's record of a dispatch; `report` is the
// agent's own words, verbatim.

export type RunStatus =
  | 'queued'
  | 'running'
  | 'success'
  | 'attention'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

// What the turn cost. Mirrors RunUsage in src/core/runs.ts. Every field is optional and zero is a
// real value — a free model costs nothing — so absence and zero must not render the same way.
export interface RunUsage {
  costUsd?: number;
  durationMs?: number;
  turns?: number;
  contextTokens?: number;
  outputTokens?: number;
}

export interface RunRecord {
  run: string;
  card: string;
  board: BoardName;
  skill: string;
  status: RunStatus;
  started: string;
  backend: string;
  model: string;
  effort: string;
  mode: string;
  outcome?: 'success' | 'attention';
  finished?: string;
  // When the user dealt with it. `status` is how the run ended; this is the decision taken about it.
  resolved?: string;
  previous?: string;
  prompt?: string;
  attached?: string[];
  summary?: string;
  options?: string[];
  created?: string[];
  // VibeBoard's explanation when there is no report to speak for the run.
  note?: string;
  usage?: RunUsage; // what it cost, when the backend said
  report: string;
}

export interface DispatchRequest {
  board: BoardName;
  card: string;
  skill: string;
  prompt?: string;
  attachments?: string[];
  previous?: string;
  backend?: string;
  model?: string;
  effort?: string;
  mode?: string;
}

export interface RunList {
  runs: RunRecord[];
  // Ids the server currently has processes for, and ids waiting for a slot. The records carry the
  // same information, but only the server knows which of them it is actually holding.
  active: string[];
  queued: string[];
}

export async function listRuns(): Promise<RunList> {
  const res = await fetch('/api/runs');
  if (!res.ok) throw new Error('Failed to load runs');
  return res.json() as Promise<RunList>;
}

export async function listCardRuns(board: BoardName, card: string): Promise<RunRecord[]> {
  const res = await fetch(`/api/runs/${board}/${encodeURIComponent(card)}`);
  if (!res.ok) throw new Error('Failed to load this card’s runs');
  return (await res.json()).runs as RunRecord[];
}

export function dispatchRun(body: DispatchRequest): Promise<{ run: RunRecord }> {
  return post<{ run: RunRecord }>('/api/runs', body);
}

export function cancelRun(run: string): Promise<{ ok: boolean }> {
  return post<{ ok: boolean }>(`/api/runs/${encodeURIComponent(run)}/cancel`, {});
}

// Mark a run dealt with, so it stops asking. Idempotent on the server: two clicks are one decision.
export function resolveRun(board: BoardName, card: string, run: string): Promise<{ run: RunRecord }> {
  return post<{ run: RunRecord }>(
    `/api/runs/${board}/${encodeURIComponent(card)}/${encodeURIComponent(run)}/resolve`,
    {},
  );
}

// Write a skill from its fields; the server serialises the YAML and answers with the catalogue as it
// now reads it — including a validation failure the fields alone could not predict.
export function putSkill(
  slug: string,
  fields: {
    name: string;
    description: string;
    boards: BoardName[];
    columns: string[];
    prompt: string;
  },
): Promise<SkillCatalogue> {
  return put<SkillCatalogue>(`/api/skills/${encodeURIComponent(slug)}`, fields);
}
