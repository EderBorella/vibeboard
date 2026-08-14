// ---- Project Control -------------------------------------------------------

import { post, request } from './http';

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
