import type {
  ArchivedCard,
  BoardName,
  Card,
  CardFrontmatterPatch,
  ProjectConfig,
  ProjectSnapshot,
  VerifyMode,
} from './shared';

import { authHeader, authToken, clearToken } from './token';

// A failed call, carrying the status as data rather than only as prose. Six readers in this module
// used to skip the `res.ok` check entirely and return the error body as if it were the answer, so an
// unauthenticated browser saw an empty project list and no explanation — indistinguishable from a
// fresh install. `status` is what lets a caller tell "you are not signed in" from "that failed".
export class ApiError extends Error {
  readonly status: number;
  // The server's machine-readable code where it sent one, so a caller can branch on WHY without
  // matching on prose that is meant to be improvable. Only the sign-in routes send it today.
  readonly reason: string | undefined;

  constructor(status: number, message: string, reason?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.reason = reason;
  }

  get unauthorized(): boolean {
    return this.status === 401;
  }
}

let unauthorizedHandler: (() => void) | undefined;

// Fired once per 401 from anywhere in the module, so a credential that stops working — revoked from
// another device, or a server whose store was cleared — drops the app back to sign-in from one place
// instead of twenty-five call sites each deciding for themselves.
export function onUnauthorized(fn: () => void): void {
  unauthorizedHandler = fn;
}

interface RequestOptions {
  // What to say when the server sends no `error` of its own. The server's words win where it has any.
  fallback?: string;
  // Statuses that are a normal answer for this endpoint rather than a failure, handed back to the
  // caller as a Response. Only 409-means-something cases; never 401.
  allow?: number[];
}

// Every call in this module goes through here: the credential is attached in one place, and a
// non-ok response becomes a thrown ApiError in the same place. There is deliberately no bypass
// flag — a bypass is how the laundering came back.
async function request(url: string, init: RequestInit = {}, opts: RequestOptions = {}): Promise<Response> {
  // Captured before the call, so the 401 handler below can tell WHICH credential was refused.
  const sent = authToken();
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), ...authHeader() },
  });
  if (res.ok || opts.allow?.includes(res.status)) return res;
  const body = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
  if (res.status === 401 && sent && sent === authToken()) discardCredential();
  throw new ApiError(res.status, body.error ?? opts.fallback ?? res.statusText, body.reason);
}

// A 401 only means "this browser's credential is no good" when the credential that was refused is
// still the one this browser holds. THE TWO CASES IT MUST NOT FIRE ON, both of which happened:
//
//   sent === ''            a request made while signing in. Five hooks fetch on mount, so five 401s
//                          were already in flight when the claim came back — and clearing on those
//                          threw away the credential the claim had just obtained, then started a
//                          fresh flow, which found the device store no longer empty and asked a
//                          person to approve the browser that had already signed itself in.
//   sent !== authToken()   a request that left before a newer credential arrived. Same shape: a late
//                          answer about an old token must not revoke the new one.
function discardCredential(): void {
  clearToken();
  unauthorizedHandler?.();
}

async function send<T>(method: 'POST' | 'PUT' | 'PATCH', url: string, body: unknown): Promise<T> {
  const res = await request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<T>;
}

function post<T>(url: string, body: unknown): Promise<T> {
  return send<T>('POST', url, body);
}

function put<T>(url: string, body: unknown): Promise<T> {
  return send<T>('PUT', url, body);
}

function patch<T>(url: string, body: unknown): Promise<T> {
  return send<T>('PATCH', url, body);
}

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
  const url = `/api/models?backend=${encodeURIComponent(backend)}`;
  return (await request(url, {}, { fallback: 'Failed to load the model list' })).json();
}

export async function getModelStatus(id: string): Promise<ModelStatus | null> {
  const url = `/api/model-status?id=${encodeURIComponent(id)}`;
  const res = await request(url, {}, { fallback: 'Failed to check this model' });
  return (await res.json()).status;
}

export async function listProjects(root?: string): Promise<ProjectRef[]> {
  const q = root ? `?root=${encodeURIComponent(root)}` : '';
  return (await request(`/api/projects${q}`, {}, { fallback: 'Failed to list projects' })).json();
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
  const res = await request(`/api/cards/${board}/${id}/raw`, {}, { fallback: 'Failed to load card file' });
  return (await res.json()).raw as string;
}

export async function putRaw(board: BoardName, id: string, raw: string): Promise<void> {
  await request(
    `/api/cards/${board}/${id}/raw`,
    { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ raw }) },
    { fallback: 'Failed to save card file' },
  );
}

// Symmetric link reconcile — updates both sides. The single path for link changes.
export async function setLinks(board: BoardName, id: string, links: string[]): Promise<void> {
  await request(
    `/api/cards/${board}/${id}/links`,
    { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ links }) },
    { fallback: 'Failed to update links' },
  );
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
  const res = await request(`/api/archive/${board}`, {}, { fallback: 'Failed to load the archive' });
  return (await res.json()).cards as ArchivedCard[];
}

// Omit toColumnSlug to land in the column the card was archived from (or the board's first
// column, if that one no longer exists).
export function restoreCard(board: BoardName, id: string, toColumnSlug?: string): Promise<Card> {
  return post<Card>(`/api/cards/${board}/${id}/restore`, toColumnSlug ? { toColumnSlug } : {});
}

// ---- Project Control -------------------------------------------------------

export type ControlCategory = 'instructions' | 'foundation' | 'skills' | 'docs' | 'resources';

export interface ControlFile {
  path: string;
  name: string;
  category: ControlCategory;
  managed: boolean;
  deletable: boolean;
  renameable: boolean;
}

export interface ControlGroup {
  key: ControlCategory;
  label: string;
  files: ControlFile[];
  // Whether this group offers "+ new". From the server: it owns where a new file of each kind goes.
  creatable: boolean;
}

export interface ResourceLink {
  title: string;
  url: string;
  note?: string;
}

export async function listControlFiles(): Promise<ControlGroup[]> {
  const res = await request('/api/control/files', {}, { fallback: 'Failed to load control files' });
  return (await res.json()).groups as ControlGroup[];
}

export async function getControlFile(path: string): Promise<ControlFile & { content: string }> {
  const url = `/api/control/file?path=${encodeURIComponent(path)}`;
  return (await request(url, {}, { fallback: 'Failed to load file' })).json();
}

export async function putControlFile(path: string, content: string): Promise<void> {
  await request(
    '/api/control/file',
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path, content }),
    },
    { fallback: 'Failed to save file' },
  );
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
  const url = `/api/control/file?path=${encodeURIComponent(path)}`;
  await request(url, { method: 'DELETE' }, { fallback: 'Failed to delete file' });
}

export async function getResources(): Promise<ResourceLink[]> {
  const res = await request('/api/control/resources', {}, { fallback: 'Failed to load resources' });
  return (await res.json()).links as ResourceLink[];
}

export async function putResources(links: ResourceLink[]): Promise<void> {
  await request(
    '/api/control/resources',
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ links }),
    },
    { fallback: 'Failed to save resources' },
  );
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
  const url = `/api/explorer/list?path=${encodeURIComponent(path)}`;
  return (await request(url, {}, { fallback: 'Failed to list folder' })).json();
}

export async function readFsFile(path: string): Promise<FileRead> {
  const url = `/api/explorer/file?path=${encodeURIComponent(path)}`;
  return (await request(url, {}, { fallback: 'Failed to load file' })).json();
}

export async function putFsFile(path: string, content: string): Promise<void> {
  await request(
    '/api/explorer/file',
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path, content }),
    },
    { fallback: 'Failed to save file' },
  );
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

// One entry: a file, a link, or an empty folder. 'not-empty' is a normal answer rather than an error —
// the caller has a harder question to ask in that case.
export async function deleteFsEntry(path: string): Promise<'ok' | 'not-empty'> {
  const url = `/api/explorer/entry?path=${encodeURIComponent(path)}`;
  // 409 is `allow`ed rather than caught: it is this endpoint's second normal answer, and the caller
  // has a harder question to ask the user in that case.
  const res = await request(url, { method: 'DELETE' }, { allow: [409], fallback: 'Failed to delete' });
  return res.status === 409 ? 'not-empty' : 'ok';
}

// A folder and everything in it. `confirm` is the folder's own name as the user typed it; the server
// checks it again, so this is not the only thing standing in the way.
export async function deleteFsTree(path: string, confirm: string): Promise<void> {
  const url = `/api/explorer/tree?path=${encodeURIComponent(path)}&confirm=${encodeURIComponent(confirm)}`;
  await request(url, { method: 'DELETE' }, { fallback: 'Failed to delete folder' });
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
  return (await request('/api/skills')).json() as Promise<SkillCatalogue>;
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
  // Absent together for a run about the PROJECT rather than a card — a checkup or a pre-flight.
  // Both or neither: the server refuses a record carrying one half of the pair.
  card?: string;
  board?: BoardName;
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
  suggestions?: number; // how many findings it filed; absent means the count could not be taken
  filesChanged?: number; // measured from git; absent means there was no answer, never zero
  // What a critic run itself answered, and what was decided about THIS run (decision 18). The verdict
  // is meant to be reviewable, and a field the UI cannot see is a verdict that only exists on disk.
  score?: number;
  overshoot?: string;
  verification?: Verification;
  report: string;
}

// Mirrors src/core/verify.ts. A verdict and the evidence behind it: the failing command and its output
// for `gates`/`smoke`, or the score AND the threshold it was judged against for `critic` — a score with
// no threshold beside it means nothing to a reader later.
export interface Verification {
  mode: VerifyMode;
  passed: boolean;
  at: string;
  command?: string;
  output?: string;
  score?: number;
  threshold?: number;
  reason?: string;
  by?: string; // the critic run that judged this one
  overshoot?: string;
}

// What the UI carries, as data. Compared against the server's own list in test/mirror.test.ts, because a
// hand-mirrored interface has no runtime keys and drift is otherwise silent — this slice added three
// fields on the server and none here, and nothing noticed.
export const RUN_RECORD_KEYS = [
  'run',
  'card',
  'board',
  'skill',
  'status',
  'started',
  'backend',
  'model',
  'effort',
  'mode',
  'outcome',
  'finished',
  'resolved',
  'previous',
  'prompt',
  'attached',
  'summary',
  'options',
  'created',
  'note',
  'usage',
  'suggestions',
  'filesChanged',
  'score',
  'overshoot',
  'verification',
  'report',
] as const;

// Fields the server writes that the UI deliberately does NOT carry, with the reason. Kept as a list so
// the guard can be exact: a new server field then forces a decision — mirror it, or say here why not —
// rather than passing unnoticed because the two sides were only ever compared loosely.
export const RUN_RECORD_NOT_MIRRORED = [
  // The run's process group and its leader's start time. Persisted so a later server can reap what this
  // one left behind; nothing on screen shows either, and a pid in the UI would invite acting on it.
  'pgid',
  'pgstart',
] as const;

// A field on the interface above that `RUN_RECORD_KEYS` does not name. `never` when every one is there;
// otherwise this line fails to compile and names the field the guard would have missed.
type UnlistedRunField = Exclude<keyof RunRecord, (typeof RUN_RECORD_KEYS)[number]>;
const _everyRunFieldIsListed: UnlistedRunField extends never ? true : UnlistedRunField = true;
void _everyRunFieldIsListed;

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
  const res = await request('/api/runs', {}, { fallback: 'Failed to load runs' });
  return res.json() as Promise<RunList>;
}

// What a project or a card has spent. Mirrors Spend in src/core/accounting.ts: `costUsd` is ABSENT
// when not one run reported a cost, which is not the same as zero and must not render the same way.
export interface Spend {
  runs: number;
  withCost: number;
  withoutCost: number;
  costUsd?: number;
  outputTokens?: number;
  durationMs?: number;
}

// One card's line in the ledger: what it cost, and how many attempts each skill has used against the
// cap. Per skill because that is how the cap is counted — a critic run must not inflate the tally of
// the skill doing the work.
export interface CardLedgerData {
  spend: Spend;
  attempts: Record<string, number>;
  attemptCap: number;
}

export interface CardRuns {
  runs: RunRecord[];
  account: CardLedgerData;
}

export async function listCardRuns(board: BoardName, card: string): Promise<CardRuns> {
  const url = `/api/runs/${board}/${encodeURIComponent(card)}`;
  const res = await request(url, {}, { fallback: 'Failed to load this card’s runs' });
  return (await res.json()) as CardRuns;
}

export interface Accounting {
  project: Spend;
  cards: { board: BoardName; card: string; spend: Spend; attempts: Record<string, number> }[];
  attemptCap: number;
  // Which cap is actually bounding this project (S10). A dollar dial that can never trip tells the
  // user the opposite of the truth about what will stop the run.
  // Absent for a project with no auto-pilot block — it has no caps, so there is no cap to name.
  cap?: { cap: 'budget' | 'iterations'; why: string };
}

// --- Auto-pilot state and the three stops ----------------------------------
// Mirrors src/core/autopilot-state.ts. Persisted on the server, because if `running` survives a
// reload then `halted` must too — otherwise a refresh would bypass the overlay that explains it.

// Arrays, not bare unions, and that is the point: a type alias is erased at build time, so nothing could
// assert this mirror against the server's. `test/mirror.test.ts` now does, in both directions.
export const AUTOPILOT_STATES = ['idle', 'running', 'stopped', 'halted'] as const;
export type AutopilotStateName = (typeof AUTOPILOT_STATES)[number];

// Every stop resolves to a named reason, and exactly ONE of them is a success. An exhausted budget
// and a reached cap both end tidily and neither means the work is done.
export const STOP_REASONS = [
  'stopped',
  'killed',
  'exhausted',
  'capped',
  'stalled',
  'complete',
  // Nothing to do in the first place — no live card on any board. Apart from `complete` because the
  // absence of unfinished work is not the presence of finished work.
  'no-op',
  'interrupted',
  'unreadable',
] as const;
export type StopReason = (typeof STOP_REASONS)[number];

// The one rule about reasons the UI needs, mirrored rather than re-derived. `TopBar` used to spell it as
// `reason === 'complete' ? …` inline while the server's `isSuccessReason` had no caller at all — two
// statements of one rule, and the next reason added to the success side would have been added to one.
export function isSuccessReason(reason: StopReason): boolean {
  return reason === 'complete';
}

export interface AutopilotState {
  state: AutopilotStateName;
  iteration: number;
  dispatchesSinceCheckup: number;
  needsCheckup: boolean;
  reason?: StopReason;
  detail?: string;
  at?: string;
  servicePgid?: number;
  servicePgstart?: number;
}

export async function getAutopilotState(): Promise<AutopilotState> {
  const res = await request('/api/autopilot/state', {}, { fallback: 'Failed to read auto-pilot’s state' });
  return (await res.json()).state as AutopilotState;
}

// Stops dispatching. The app is untouched: chat, manual runs and the board all carry on.
export function softStopAutopilot(detail?: string): Promise<{ state: AutopilotState }> {
  return post('/api/autopilot/stop', detail ? { detail } : {});
}

// Kills everything in the project and halts it. A separate call from the soft stop rather than a flag
// on it: one is reversible and the other kills work in flight.
export function killAutopilot(detail?: string): Promise<{ state: AutopilotState }> {
  return post('/api/autopilot/kill', detail ? { detail } : {});
}

export function restartAutopilot(): Promise<{ state: AutopilotState }> {
  return post('/api/autopilot/restart', {});
}

// Starts the loop. Refused with a sentence when the project is not ready, when there is no sandbox, or when
// it is already running or halted — and `post` turns each of those into a thrown Error carrying the server's
// own words, which is what the control renders. A button whose refusal is invisible is a dead end.
export function startAutopilot(): Promise<{ state: AutopilotState }> {
  return post('/api/autopilot/start', {});
}

// --- The diary ---------------------------------------------------------------------------------------
// Mirrors src/core/diary.ts. An array rather than a bare union so test/mirror.test.ts can assert it: slice
// D shipped six hand-mirrored types with no guard, and one of them gained a member mid-slice.
export const DIARY_KINDS = ['run', 'checkup', 'lifecycle', 'note'] as const;
export type DiaryKind = (typeof DIARY_KINDS)[number];

export interface DiaryEntry {
  at: string;
  kind: DiaryKind;
  text: string;
  iteration?: number;
  card?: string;
  board?: BoardName;
  skill?: string;
  outcome?: string;
}

export async function listDiary(): Promise<DiaryEntry[]> {
  const res = await request('/api/log', {}, { fallback: 'Failed to read this project’s log' });
  return (await res.json()).entries as DiaryEntry[];
}

// Everything except `at`, which is the server's — a caller choosing its own timestamps could write an
// event into the past and change what the sequence says happened.
// Through `post`, which sets content-type. Hand-rolled, it sent none and Fastify answered 415 —
// invisible for as long as it lasted because every test of this function mocks the module itself,
// so the request never met a real server.
export async function addDiaryEntry(entry: Omit<DiaryEntry, 'at'>): Promise<DiaryEntry> {
  return (await post<{ entry: DiaryEntry }>('/api/log', entry)).entry;
}

export async function getAccounting(): Promise<Accounting> {
  const res = await request('/api/accounting', {}, { fallback: 'Failed to load this project’s usage' });
  return (await res.json()) as Accounting;
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

// The same decision for either kind of run. A project run has no card in its path, so it has its own
// endpoint — and every caller holds the record rather than the three parts, so the choice belongs
// here instead of at each button.
export function resolveRunRecord(record: RunRecord): Promise<{ run: RunRecord }> {
  return record.board && record.card
    ? resolveRun(record.board, record.card, record.run)
    : post<{ run: RunRecord }>(`/api/project-runs/${encodeURIComponent(record.run)}/resolve`, {});
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

// ---- Auto-pilot ------------------------------------------------------------

// One answer to "could auto-pilot start here, and if not, why not?", so the settings panel and
// everything after it read the same list rather than each deciding for themselves.
export interface Readiness {
  ok: boolean;
  blockers: string[];
  readme: { ok: boolean; path?: string; reason?: string };
  foundation: { present: string[]; missing: string[]; ok: boolean };
  gates: { ok: boolean; reason?: string; count: number };
  smoke: { ok: boolean; reason?: string };
  routes: { problems: string[]; count: number };
}

// ---- Signing in ------------------------------------------------------------
// The first three are the only calls in this module that carry no credential, because they are how a
// browser gets one. They still go through `request` — the header helper simply adds nothing when
// there is no token, and routing them anywhere else would be a second path to the network.

export interface SigninRequestOpened {
  id: string;
  // What the approving browser will be shown, so this browser can display the same thing and the
  // user can match one against the other.
  label: string;
  address: string;
}

export type SigninCollected =
  | { state: 'pending' }
  | { state: 'refused' }
  | { state: 'approved'; token: string }
  | { state: 'expired' };

export async function claimSignin(): Promise<{ token: string }> {
  return (await request('/auth/claim', { method: 'POST' })).json();
}

export async function requestSignin(): Promise<SigninRequestOpened> {
  return (await request('/auth/request', { method: 'POST' })).json();
}

export async function collectSignin(id: string): Promise<SigninCollected> {
  return (await request(`/auth/request/${encodeURIComponent(id)}`)).json();
}

export interface SigninDevice {
  id: string;
  label: string;
  address: string;
  created: string;
  lastSeen: string;
}

export interface SigninPending {
  id: string;
  label: string;
  address: string;
  at: string;
}

export interface SigninState {
  devices: SigninDevice[];
  // Which row is this browser. Null for a caller holding the admin token, which belongs to no device.
  thisDevice: string | null;
  pending: SigninPending[];
}

export async function getSigninState(): Promise<SigninState> {
  return (await request('/api/signin', {}, { fallback: 'Failed to read the sign-in state' })).json();
}

export function approveSignin(id: string): Promise<{ ok: true }> {
  return post(`/api/signin/approve/${encodeURIComponent(id)}`, {});
}

export function refuseSignin(id: string): Promise<{ ok: true }> {
  return post(`/api/signin/refuse/${encodeURIComponent(id)}`, {});
}

export async function revokeDevice(id: string): Promise<void> {
  await request(
    `/api/signin/devices/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
    { fallback: 'Failed to sign that browser out' },
  );
}

// Signs every browser out, this one included, and re-opens the silent first claim — so the next page
// load on this machine signs itself in again. This is "regenerate the token", without a restart.
export function signOutEverything(): Promise<{ ok: true }> {
  return post('/api/signin/clear', {});
}

export async function getReadiness(): Promise<Readiness> {
  const url = '/api/autopilot/readiness';
  return (await request(url, {}, { fallback: 'Failed to check whether auto-pilot could start' })).json();
}
