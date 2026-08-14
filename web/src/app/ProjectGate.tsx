import { useEffect, useState } from 'react';
import { listProjects, openProject, type ProjectRef, scaffoldProject } from '../api';
import { useAction } from '../useAction';
import { slugify } from '../viewmodel';

interface Props {
  onOpened: () => void;
}

// TWO OPTIONS, and only two: open a project VibeBoard already knows, or create one. Ruled
// 2026-08-09, alongside making a container part of what creating a project produces.
//
// What went, and why each one went:
//
//  - "Open by path" — a free-text box that could open any folder on the disk. A project is now a
//    thing with a container, per-project agent state and a place in this list; typing a path that
//    has none of that produced something that looked like a project and was not.
//  - "Adopt an existing folder" — bringing a repository you already have under VibeBoard is a real
//    feature and it is coming back, deliberately AFTER containment rather than designed against a
//    lifecycle that is still moving. A box is currently born with a project, and an adopted project
//    has no birth; that needs answering rather than papering over.
//
// The list itself is VibeBoard's own record of projects, NOT a query for containers. A box removed
// by a prune or an image rebuild must not make a project vanish from this screen — it is remade,
// quietly, when the project is opened.

// Force the project name toward the VibeBoard pattern (dash-separated, lowercase) as the
// user types. Leading dashes are stripped; a trailing dash is tolerated so separators can
// be typed mid-word. slugify() produces the final canonical form on submit.
function toNamePattern(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '');
}

export function ProjectGate({ onOpened }: Props) {
  const [projects, setProjects] = useState<ProjectRef[]>([]);
  const [newParent, setNewParent] = useState('');
  const [newName, setNewName] = useState('');
  const { busy, error, run: attempt } = useAction();

  const nameSlug = slugify(newName);
  const parent = newParent.replace(/\/+$/, '');
  const targetPath = parent && nameSlug ? `${parent}/${nameSlug}` : '';

  useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);

  // Both buttons end the same way: the gate is dismissed only once the server says the project is
  // open, so a refusal leaves the list on screen with the reason under it.
  async function run(fn: () => Promise<unknown>): Promise<void> {
    await attempt(async () => {
      await fn();
      onOpened();
    });
  }

  return (
    <div className="gate">
      <div className="gate-card">
        <h2>Open a project</h2>

        {projects.length > 0 ? (
          <ul className="gate-list">
            {projects.map((p) => (
              <li key={p.path}>
                <button disabled={busy !== null} onClick={() => run(() => openProject(p.path))}>
                  <span className="gate-list-name">{p.name}</span>
                  <span className="gate-list-path">{p.path}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="gate-hint">No projects yet. Create one below.</div>
        )}

        <h3>New project</h3>
        <div className="gate-hint">
          Creates the folder, the board, and the container its agents will run in. The container is built the
          first time and reused after that.
        </div>
        <label className="gate-field">
          <span>Location (parent folder)</span>
          <input
            value={newParent}
            placeholder="/path/to/projects"
            onChange={(e) => setNewParent(e.target.value)}
          />
        </label>
        <label className="gate-field">
          <span>Name (dash-separated, lowercase)</span>
          <div className="gate-row">
            <input
              value={newName}
              placeholder="my-project"
              onChange={(e) => setNewName(toNamePattern(e.target.value))}
            />
            <button
              disabled={busy !== null || !targetPath}
              onClick={() => run(() => scaffoldProject(targetPath, nameSlug))}
            >
              Create
            </button>
          </div>
        </label>
        {targetPath && (
          <div className="gate-preview">
            Creates <code>{targetPath}</code>
          </div>
        )}

        {error && <div className="gate-error">{error}</div>}
      </div>
    </div>
  );
}
