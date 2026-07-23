import { useEffect, useState } from 'react';
import { listProjects, openProject, scaffoldProject, type ProjectRef } from '../api';

interface Props {
  onOpened: () => void;
}

export function ProjectGate({ onOpened }: Props) {
  const [projects, setProjects] = useState<ProjectRef[]>([]);
  const [openPath, setOpenPath] = useState('');
  const [newPath, setNewPath] = useState('');
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
          <span>Path</span>
          <input value={newPath} placeholder="/path/to/new-project" onChange={(e) => setNewPath(e.target.value)} />
        </label>
        <label className="gate-field">
          <span>Name</span>
          <div className="gate-row">
            <input value={newName} placeholder="My Project" onChange={(e) => setNewName(e.target.value)} />
            <button
              disabled={busy || !newPath || !newName}
              onClick={() => run(() => scaffoldProject(newPath, newName))}
            >
              Create
            </button>
          </div>
        </label>

        {error && <div className="gate-error">{error}</div>}
      </div>
    </div>
  );
}
