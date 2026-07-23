import { useEffect, useState } from 'react';
import { listProjects, openProject, scaffoldProject, type ProjectRef } from '../api';
import { slugify } from '../viewmodel';

interface Props {
  onOpened: () => void;
}

// Force the project name toward the VibeBoard pattern (dash-separated, lowercase) as the
// user types. Leading dashes are stripped; a trailing dash is tolerated so separators can
// be typed mid-word. slugify() produces the final canonical form on submit.
function toNamePattern(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '');
}

export function ProjectGate({ onOpened }: Props) {
  const [projects, setProjects] = useState<ProjectRef[]>([]);
  const [openPath, setOpenPath] = useState('');
  const [newParent, setNewParent] = useState('');
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const nameSlug = slugify(newName);
  const parent = newParent.replace(/\/+$/, '');
  const targetPath = parent && nameSlug ? `${parent}/${nameSlug}` : '';

  useEffect(() => { listProjects().then(setProjects).catch(() => setProjects([])); }, []);

  async function run(fn: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onOpened();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gate">
      <div className="gate-card">
        <h2>Open a project</h2>

        {projects.length > 0 && (
          <ul className="gate-list">
            {projects.map((p) => (
              <li key={p.path}>
                <button disabled={busy} onClick={() => run(() => openProject(p.path))}>
                  <span className="gate-list-name">{p.name}</span>
                  <span className="gate-list-path">{p.path}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <label className="gate-field">
          <span>Open by path</span>
          <div className="gate-row">
            <input
              value={openPath}
              placeholder="/path/to/project"
              onChange={(e) => setOpenPath(e.target.value)}
            />
            <button disabled={busy || !openPath} onClick={() => run(() => openProject(openPath))}>Open</button>
          </div>
        </label>

        <h3>New project</h3>
        <label className="gate-field">
          <span>Location (parent folder)</span>
          <input value={newParent} placeholder="/data/projects" onChange={(e) => setNewParent(e.target.value)} />
        </label>
        <label className="gate-field">
          <span>Name (dash-separated, lowercase)</span>
          <div className="gate-row">
            <input value={newName} placeholder="my-project" onChange={(e) => setNewName(toNamePattern(e.target.value))} />
            <button
              disabled={busy || !targetPath}
              onClick={() => run(() => scaffoldProject(targetPath, nameSlug))}
            >
              Create
            </button>
          </div>
        </label>
        {targetPath && <div className="gate-preview">Creates <code>{targetPath}</code></div>}

        {error && <div className="gate-error">{error}</div>}
      </div>
    </div>
  );
}
