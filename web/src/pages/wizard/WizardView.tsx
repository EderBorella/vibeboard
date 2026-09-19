import { type ReactNode, useState } from 'react';
import { Button } from '../../atoms/Button';
import { Control } from '../../atoms/Control';
import { Readout } from '../../atoms/Readout';
import { Stack } from '../../atoms/Stack';
import { Surface } from '../../atoms/Surface';
import { Text } from '../../atoms/Text';
import {
  buildAgentImage,
  clearWizard,
  getWizard,
  patchConfig,
  putWizard,
  type SandboxState,
  scaffoldProject,
} from '../../lib/api';
import type { ProjectSnapshot, ScaffoldMode, WizardState, WizardStep } from '../../lib/shared';
import { useAction } from '../../lib/useAction';
import { useBuildLog } from '../../lib/useBuildLog';
import { useFetched } from '../../lib/useFetched';
import { useSandbox } from '../../lib/useSandbox';
import type { WizardStart } from '../../lib/useWizard';
import { projectTarget, slugify, toNamePattern } from '../../lib/viewmodel';
import { Field } from '../../molecules/Field';
import { Notice } from '../../molecules/Notice';
import { BackendPicker } from '../../organisms/copilot/BackendPicker';

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

// THE FILE IS THE ONLY COPY OF WHAT HAS BEEN ANSWERED, and `putWizard` replaces it whole. This screen
// holds none of it — a step is mounted when it is reached and unmounted when it is left — so a step that
// wrote `{ mode, step }` from what it happens to know would silently delete the answers of the step
// before it. Read on entry, written on the way out.
const NO_WIZARD: { state: WizardState | null } = { state: null };

function useSaved(mode: ScaffoldMode): (step: WizardStep) => WizardState {
  const { value } = useFetched(getWizard, [], NO_WIZARD);
  // The fallback is for the one case the file can be missing here: it was cleared in another tab. Setup
  // then starts recording again from this step rather than refusing to move.
  return (step) => ({ ...(value.state ?? { mode, step }), step });
}

export function WizardView({ mode, start, snapshot, bump, onOpened, onExit }: Props) {
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
  else if (step === 'backend')
    body = <BackendStep mode={mode} snapshot={snapshot} bump={bump} onContinue={() => setStep('form')} />;
  else if (step === 'handoff') body = <HandoffStep />;
  else body = <PendingStep onContinue={() => setStep('handoff')} />;

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

// WHAT EACH REFUSAL IS ABOUT, over the probe's own sentence. The sentence is the server's and is
// rendered verbatim — it is the only thing on the screen that names the command or the setting that
// clears it — so all this adds is the KIND of thing about to be asked of the reader: work outside the
// app, work the app can do for them, or a setting to change. A heading that guessed at the remedy would
// be the fault SandboxPanel's build button already documents: a remedy that does not match the fault a
// person has just read is worse than no remedy at all.
const REFUSAL_TITLE: Record<NonNullable<SandboxState['refusalKind']>, string> = {
  credential: 'Almost — one thing to do outside VibeBoard',
  docker: 'Almost — the container it runs in is not ready',
  backend: 'Almost — the assistant is not answering',
  attached: 'Almost — one thing to change in Settings',
};

// Which button is spinning. Keyed rather than one shared flag because two of these are on screen
// together in the state that matters — a refusal a build would fix, with Continue still standing.
type Pressed = 'assistant' | 'build' | 'continue';

// THE STEP YOU CANNOT ARGUE WITH, and the one place in the wizard where the answer comes from the
// machine rather than from the person. W2: Continue is gated on the live check, because a setup that
// ends with an assistant that cannot start has set nothing up — and the fix is on this screen rather
// than in a document, because everything the probe can refuse names its own remedy.
function BackendStep({
  mode,
  snapshot,
  bump,
  onContinue,
}: {
  mode: ScaffoldMode;
  snapshot: ProjectSnapshot | null;
  bump: number;
  onContinue: () => void;
}) {
  const saved = useSaved(mode);
  // Re-asked on entry, after the assistant changes, and after a build lands: all three change the
  // answer, and none of them is observable any other way. `useSandbox` re-fetches on whatever it is
  // keyed to, which is this counter and nothing else on the screen.
  const [asked, setAsked] = useState(0);
  const { sandbox } = useSandbox(asked);
  // The build's output arrives over the socket as `box:build` frames rather than in the response, which
  // does not come back for minutes. `bump` is the TAB's generation, threaded from the shell: `socketFor`
  // is last-write-wins, so a literal here would replace the app's own socket rather than share it.
  const log = useBuildLog(bump);
  const { busy, error, run } = useAction<Pressed>();
  // Absent for as long as it takes the scaffolded project's first snapshot to arrive over the socket.
  const copilot = snapshot?.config.copilot;
  // `agentRefusal` AND NOT `ok`, because they are different questions and this one is the question the
  // product asks before it starts an agent: a project attached to an OpenCode server VibeBoard did not
  // start answers `ok: true` and still cannot run anything. Null is "not asked yet", which is neither.
  const ready = sandbox?.agentRefusal === null;

  // The whole copilot block, for `chooseBackend`'s reason in AutopilotBar: `backends` holds each
  // assistant's remembered model, and the per-assistant slots exist so one choice cannot discard the
  // other's.
  const choose = (next: string): void => {
    if (!copilot || next === copilot.backend) return;
    void run(async () => {
      await patchConfig({ copilot: { ...copilot, backend: next } });
      setAsked((n) => n + 1);
    }, 'assistant');
  };

  const build = (): void => {
    log.reset();
    void run(async () => {
      await buildAgentImage();
      setAsked((n) => n + 1);
    }, 'build');
  };

  const go = (): void => {
    void run(async () => {
      await putWizard(saved('form'));
      onContinue();
    }, 'continue');
  };

  return (
    <>
      <Text as="h2" size="title" ink="strong" family="display">
        Is the assistant ready?
      </Text>
      <Text role="hint">
        Your project's work is done by an assistant running in a container on this machine. This is a live
        check that one can actually start.
      </Text>

      {copilot && (
        <BackendPicker
          label="Which assistant runs your project"
          value={copilot.backend}
          disabled={busy !== null}
          onChange={choose}
        />
      )}

      {sandbox === null && <Text role="hint">Checking…</Text>}
      {ready && (
        <Notice as="p" tone="ok">
          Connected and ready.
        </Notice>
      )}
      {sandbox?.refusalKind && (
        <>
          <Text as="h3" size="body" ink="strong">
            {REFUSAL_TITLE[sandbox.refusalKind]}
          </Text>
          {/* THE SERVER'S WORDS, WHOLE. Every one of these sentences ends on the thing to do, and they
              are computed by the same gate that will refuse the first run — so a wizard that reworded
              them could send somebody to fix what is not broken. `reason` is the fault's own sentence;
              an attached server is refused by the gate alone and has none, so that one falls back to
              the gate's. */}
          <Notice as="p" tone="warn">
            {sandbox.reason ?? sandbox.agentRefusal}
          </Notice>
        </>
      )}

      {/* ONLY WHERE A BUILD IS THE ANSWER. `buildable` is set for the missing-image fault and nothing
          else, so this never offers to build against a daemon that is not running. */}
      {sandbox?.buildable && (
        <>
          <Button variant="primary" disabled={busy !== null} onClick={build}>
            {busy === 'build' ? 'Building…' : 'Build it now'}
          </Button>
          <Text role="hint">
            It takes a few minutes the first time and only happens once. You can watch it below.
          </Text>
          {/* ONE LINE, THE LATEST, as SandboxPanel shows it: a build prints hundreds and what a person
              needs from them is evidence it is still moving, not the transcript. */}
          {log.lines.length > 0 && <Readout>{log.lines[log.lines.length - 1]}</Readout>}
        </>
      )}

      <Stack gap={4}>
        {/* Nothing gets past a machine that cannot run an agent — and nobody has to leave setup to fix
            it, which is the whole of why the check is here rather than at the first dispatch. */}
        <Button variant="primary" disabled={!ready || busy !== null} onClick={go}>
          Continue
        </Button>
      </Stack>
      {error && <Text role="error">{error}</Text>}
    </>
  );
}

// The last step between the scaffold and the hand-off, standing in for itself until it is built. It says
// so rather than looking finished, because a step that renders nothing is indistinguishable from a step
// that broke.
function PendingStep({ onContinue }: { onContinue: () => void }) {
  return (
    <>
      <Text as="h2" size="title" ink="strong" family="display">
        A few questions
      </Text>
      <Text role="hint">
        Not built yet — this step will ask what you are making, who it is for, and what done looks like.
      </Text>
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
