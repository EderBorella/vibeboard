import { useEffect, useState } from 'react';
import { Control } from '../../atoms/Control';
import { Readout } from '../../atoms/Readout';
import { Text } from '../../atoms/Text';
import { listProjects, openProject, type ProjectRef, scaffoldProject } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { slugify } from '../../lib/viewmodel';
import { Field } from '../../molecules/Field';
import { Notice } from '../../molecules/Notice';
import { List } from '../../organisms/shared/List';
import { Row } from '../../organisms/shared/Row';

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
  // A RELATIVE PARENT IS NOT A PLACE. This field is free text and its value is concatenated straight
  // into a path, so `data/projects` — one missing leading slash — asked the server to create
  // `data/projects/calculator`, which Node resolved against the SERVER's working directory. The project
  // landed inside the VibeBoard install: docker refused its box (to `-v`, a relative string is a volume
  // NAME), auto-pilot's pre-flight commit ran in VibeBoard's own repository and stopped the run over a
  // failure in VibeBoard's test suite, and the project never got the `.git/hooks` pin its box needs.
  //
  // The endpoint refuses this too and that is the enforcement; this is so the answer arrives while the
  // person is still typing rather than as a 400 afterwards.
  const relativeParent = parent !== '' && !parent.startsWith('/');
  const targetPath = parent && nameSlug && !relativeParent ? `${parent}/${nameSlug}` : '';

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
          <List as="ul" className="gate-list">
            {projects.map((p) => (
              // A region of a list that takes a click, with no voice of its own — a `Row`, not a
              // `Button`, which is the line Phase 4 drew. `inset` because it draws its box at rest,
              // where `flat`'s rows light theirs on hover; `stack` is the name over the path.
              <Row
                as="li"
                stack
                variant="inset"
                interactive
                key={p.path}
                disabled={busy !== null}
                onClick={() => run(() => openProject(p.path))}
              >
                <span className="gate-list-name">{p.name}</span>
                <Readout>{p.path}</Readout>
              </Row>
            ))}
          </List>
        ) : (
          <Text role="hint">No projects yet. Create one below.</Text>
        )}

        <h3>New project</h3>
        <Text role="hint">
          Creates the folder, the board, and the container its agents will run in. The container is built the
          first time and reused after that.
        </Text>
        <Field label="Location (parent folder)">
          <Control
            value={newParent}
            placeholder="/path/to/projects"
            onChange={(e) => setNewParent(e.target.value)}
          />
        </Field>
        <Field label="Name (dash-separated, lowercase)">
          <Row>
            <Control
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
          </Row>
        </Field>
        {relativeParent && (
          <div className="gate-preview">
            Give an absolute path, starting with <code>/</code>. A relative one is resolved against
            VibeBoard's own folder rather than yours.
          </div>
        )}
        {targetPath && (
          <div className="gate-preview">
            Creates <code>{targetPath}</code>
          </div>
        )}

        {error && <Notice tone="bad">{error}</Notice>}
      </div>
    </div>
  );
}
