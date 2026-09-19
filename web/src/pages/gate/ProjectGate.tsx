import { useEffect, useState } from 'react';
import { Button } from '../../atoms/Button';
import { Readout } from '../../atoms/Readout';
import { Stack } from '../../atoms/Stack';
import { Surface } from '../../atoms/Surface';
import { Text } from '../../atoms/Text';
import { listProjects, openProject, type ProjectRef } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { Notice } from '../../molecules/Notice';
import { List } from '../../organisms/shared/List';
import { Row } from '../../organisms/shared/Row';

interface Props {
  onOpened: () => void;
  onNewProject: () => void;
  onMapProject: () => void;
}

// OPEN ONE VIBEBOARD ALREADY KNOWS, OR START ONE — and starting one is now two doors rather than a form.
// Ruled 2026-08-09 as two options, alongside making a container part of what creating a project produces.
//
// What went then, and what has come back:
//
//  - "Open by path" — a free-text box that could open any folder on the disk. GONE and staying gone. A
//    project is a thing with a container, per-project agent state and a place in this list; typing a path
//    that has none of that produced something that looked like a project and was not.
//  - "Adopt an existing folder" — deliberately removed until containment settled, and it is BACK, as the
//    `Map an existing repository` door below. It is a door and not a form because bringing a repository in
//    needs the same backend check and the same questions a new project needs; both paths lead into one
//    wizard and differ only in what its identity step asks. decision 76.
//
// The list itself is VibeBoard's own record of projects, NOT a query for containers. A box removed by a
// prune or an image rebuild must not make a project vanish from this screen — it is remade, quietly, when
// the project is opened.
export function ProjectGate({ onOpened, onNewProject, onMapProject }: Props) {
  const [projects, setProjects] = useState<ProjectRef[]>([]);
  const { busy, error, run: attempt } = useAction();

  useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);

  // The gate is dismissed only once the server says the project is open, so a refusal leaves the list on
  // screen with the reason under it.
  async function run(fn: () => Promise<unknown>): Promise<void> {
    await attempt(async () => {
      await fn();
      onOpened();
    });
  }

  return (
    <div className="gate">
      <Surface variant="raised" className="gate-card">
        <h2>Open a project</h2>

        {projects.length > 0 ? (
          <List as="ul" gap={3}>
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
                {/* `size`/`ink` inherit so the atom changes nothing but the weight — the step and the
                    ink are the row's. */}
                <Text weight="medium" size="inherit" ink="inherit">
                  {p.name}
                </Text>
                <Readout>{p.path}</Readout>
              </Row>
            ))}
          </List>
        ) : (
          <Text role="hint">No projects yet. Start one below.</Text>
        )}

        <h3>Start something</h3>
        <Stack gap={4} wrap>
          <Button variant="primary" onClick={onNewProject}>
            New project
          </Button>
          <Button onClick={onMapProject}>Map an existing repository</Button>
        </Stack>

        {error && <Notice tone="bad">{error}</Notice>}
      </Surface>
    </div>
  );
}
