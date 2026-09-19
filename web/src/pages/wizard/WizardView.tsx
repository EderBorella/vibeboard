import { type ReactNode, useState } from 'react';
import { Button } from '../../atoms/Button';
import { Control } from '../../atoms/Control';
import { Stack } from '../../atoms/Stack';
import { Surface } from '../../atoms/Surface';
import { Text } from '../../atoms/Text';
import { clearWizard, putWizard, scaffoldProject } from '../../lib/api';
import type { ProjectSnapshot, ScaffoldMode } from '../../lib/shared';
import { useAction } from '../../lib/useAction';
import type { WizardStart } from '../../lib/useWizard';
import { projectTarget, slugify, toNamePattern } from '../../lib/viewmodel';
import { Field } from '../../molecules/Field';

// SETTING A PROJECT UP, AS A SCREEN AND NOT A MODAL. Its later steps hold agent runs that last minutes,
// and a dialog you cannot leave a run inside is a dialog somebody closes. It is the shell's sixth
// content state for that reason — see `chooseContent` in templates/shell.ts. decision 76.
//
// IT MUST NEVER WEAR `.gate`. The browser harness proves the board by counting that class at zero, and
// this surface renders with a project open; a frame borrowed from the picker would make the board's own
// proof pass on the wizard. The card is the same shape and its own name.
interface Props {
  mode: ScaffoldMode;
  // WHERE TO OPEN, decided by how the wizard was reached rather than by what is on screen: a door
  // starts at `identity` even with another project open, and an offer to finish resumes at the step
  // the file names.
  start: WizardStart;
  // Null until the identity step has made one. Threaded now and read by the steps that ask about the
  // project itself — the backend check and the questions — which are the next parts of this phase.
  snapshot: ProjectSnapshot | null;
  // THE TAB'S ONE SOCKET GENERATION, threaded from the shell rather than invented here. Nothing on this
  // screen reads frames yet; the step that streams a container build does, and `socketFor` is
  // last-write-wins, so a literal key here would be a second socket silently replacing the app's.
  bump: number;
  onOpened: () => void;
  onExit: () => void;
}

// Where a repository already on disk would be brought in from. The folder IS the answer here, so the
// path is what was typed and the name is its last segment slugified — NOT `projectTarget`, which builds
// a path out of a parent and a name and would, for a folder whose name is not already a slug, name a
// directory that does not exist.
function adoptTarget(input: string): { relative: boolean; path: string; name: string } {
  const path = input.replace(/\/+$/, '');
  const relative = path !== '' && !path.startsWith('/');
  const name = slugify(path.split('/').pop() ?? '');
  return { relative, path: relative || !name ? '' : path, name };
}

export function WizardView({ mode, start, onOpened, onExit }: Props) {
  const [step, setStep] = useState<WizardStart>(start);
  const { busy, error, run } = useAction();

  // Abandoning setup IS deleting the file, which is what stops it being offered on the next open. Skip
  // keeps it, and that difference is the whole of what "resumable later" means here.
  const stopOffering = (): void => {
    void run(async () => {
      await clearWizard();
      onExit();
    });
  };

  let body: ReactNode;
  if (step === 'identity')
    body = (
      <IdentityStep
        mode={mode}
        onScaffolded={() => {
          setStep('backend');
          onOpened();
        }}
      />
    );
  else if (step === 'handoff') body = <HandoffStep />;
  else body = <PendingStep step={step} onContinue={() => setStep(step === 'backend' ? 'form' : 'handoff')} />;

  return (
    <Stack fill scroll justify="center" align="start" pad={[7, 6]}>
      <Surface variant="raised" className="wizard-card">
        {body}
        <Stack gap={4} wrap>
          {/* The way out of every step, quiet and always there. At the end it is the only thing left to
              press, so it stops being a skip and says so. */}
          {step === 'handoff' ? (
            <Button variant="primary" onClick={onExit}>
              Take me to the board
            </Button>
          ) : (
            <Button onClick={onExit}>Not now — take me to the board</Button>
          )}
          {/* Only once there is a file to delete. It is written by the scaffold, so at the identity step
              there is nothing to stop offering — and if another project happens to be open, its file is
              not this setup's to delete. */}
          {step !== 'identity' && (
            <Button variant="bare" disabled={busy !== null} onClick={stopOffering}>
              Stop offering this
            </Button>
          )}
        </Stack>
        {error && <Text role="error">{error}</Text>}
      </Surface>
    </Stack>
  );
}

// THE ONE STEP THAT RUNS WITH NO PROJECT OPEN, and pressing its button is what creates one: the existing
// scaffold route writes the folder, opens it and ensures its container, so every later step runs with a
// project open and the sandbox probe answering for it.
function IdentityStep({ mode, onScaffolded }: { mode: ScaffoldMode; onScaffolded: () => void }) {
  const [parent, setParent] = useState('');
  const [name, setName] = useState('');
  const [repo, setRepo] = useState('');
  const { busy, error, run } = useAction();

  const greenfield = mode === 'greenfield';
  const nameSlug = slugify(name);
  const target = greenfield ? { ...projectTarget(parent, nameSlug), name: nameSlug } : adoptTarget(repo);

  const create = (): void => {
    void run(async () => {
      // MAP MODE SENDS `brownfield`, AND IT IS THE FIRST CALLER IN THE BROWSER EVER TO: the scaffolder
      // has taken the mode since adoption left the gate, and nothing has asked for it. It is what makes
      // the difference between adding the cockpit beside somebody's work and seeding it with three
      // sample cards.
      await scaffoldProject(target.path, target.name, mode);
      // Written before the shell is told the project is open, so a project that opens with setup
      // pending is never one whose state file has not landed yet.
      await putWizard({ mode, step: 'backend' });
      onScaffolded();
    });
  };

  return (
    <>
      <Text as="h2" size="title" ink="strong" family="display">
        {greenfield ? 'Start a new project' : 'Bring in what you already have'}
      </Text>
      <Text role="hint">
        {greenfield
          ? 'Creates the folder, the board, and the container its agents will run in. The container is built the first time and reused after that.'
          : 'Adds the board and the container beside what is already there. Your files stay where they are.'}
      </Text>

      {greenfield ? (
        <>
          <Field label="Location (parent folder)">
            <Control
              value={parent}
              placeholder="/path/to/projects"
              onChange={(e) => setParent(e.target.value)}
            />
          </Field>
          <Field label="Name (dash-separated, lowercase)" error={error}>
            <Control
              value={name}
              placeholder="my-project"
              onChange={(e) => setName(toNamePattern(e.target.value))}
            />
          </Field>
        </>
      ) : (
        <Field
          label="Repository (full path)"
          hint="The folder that holds the project you want to bring in."
          error={error}
        >
          <Control value={repo} placeholder="/path/to/repository" onChange={(e) => setRepo(e.target.value)} />
        </Field>
      )}

      {target.relative && (
        <Text as="p">
          Give an absolute path, starting with <code>/</code>. A relative one is resolved against VibeBoard's
          own folder rather than yours.
        </Text>
      )}
      {target.path && (
        <Text as="p">
          {greenfield ? 'Creates ' : 'Brings in '}
          <code>{target.path}</code>
        </Text>
      )}

      <Stack gap={4}>
        <Button variant="primary" disabled={busy !== null || !target.path} onClick={create}>
          {greenfield ? 'Create the project' : 'Bring it in'}
        </Button>
      </Stack>
    </>
  );
}

// The two steps between the scaffold and the hand-off, standing in for themselves until each is built.
// They say so rather than looking finished, because a step that renders nothing is indistinguishable
// from a step that broke.
const PENDING: Record<'backend' | 'form', { title: string; line: string }> = {
  backend: {
    title: 'Is the assistant ready?',
    line: 'Not built yet — this step will check that the assistant that runs your project can start, and show you what to do if it cannot.',
  },
  form: {
    title: 'A few questions',
    line: 'Not built yet — this step will ask what you are making, who it is for, and what done looks like.',
  },
};

function PendingStep({ step, onContinue }: { step: 'backend' | 'form'; onContinue: () => void }) {
  return (
    <>
      <Text as="h2" size="title" ink="strong" family="display">
        {PENDING[step].title}
      </Text>
      <Text role="hint">{PENDING[step].line}</Text>
      <Stack gap={4}>
        <Button variant="primary" onClick={onContinue}>
          Continue
        </Button>
      </Stack>
    </>
  );
}

function HandoffStep() {
  return (
    <>
      <Text as="h2" size="title" ink="strong" family="display">
        That is setup done
      </Text>
      <Text role="hint">
        The next part needs the copilot, and it isn't built yet — everything you chose is saved.
      </Text>
    </>
  );
}
