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
import {
  type AutopilotConfig,
  BOX_KINDS,
  type BoxKind,
  type LifecycleMode,
  type ProjectSnapshot,
  type ScaffoldMode,
  type WizardState,
  type WizardStep,
} from '../../lib/shared';
import { useAction } from '../../lib/useAction';
import { useBuildLog } from '../../lib/useBuildLog';
import { useFetched } from '../../lib/useFetched';
import { useSandbox } from '../../lib/useSandbox';
import type { WizardStart } from '../../lib/useWizard';
import { csv, parseCsv, projectTarget, slugify, toNamePattern } from '../../lib/viewmodel';
import { Field } from '../../molecules/Field';
import { Notice } from '../../molecules/Notice';
import { Tabs } from '../../molecules/Tabs';
import { LifecyclePicker } from '../../organisms/autopilot/LifecyclePicker';
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
  // Null until the identity step has made one — and for as long after it as the new project's first
  // snapshot takes to arrive over the socket, which is why every step that reads the config tolerates
  // its absence rather than assuming a project is there the moment the scaffold returns.
  snapshot: ProjectSnapshot | null;
  // THE TAB'S ONE SOCKET GENERATION, threaded from the shell rather than invented here. The backend
  // step streams a container build off it, and `socketFor` is last-write-wins — so a literal key here
  // would not be a second socket beside the app's, it would silently replace it.
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
//
// WHICH MAKES THE READ A GATE AND NOT JUST A SOURCE. `null` here is "not read yet", and it is a
// different fact from a file that is not there: a Continue pressed in the window before the answer
// lands does exactly what the paragraph above forbids, and nothing errors — the file is simply shorter
// afterwards, one step's answers gone. A read that FAILED stays `null` for the same reason: a failure
// is no evidence the file is absent, so writing over it would lose the same thing.
function useSaved(mode: ScaffoldMode): {
  read: boolean;
  saved: (step: WizardStep) => WizardState;
} {
  const { value } = useFetched<{ state: WizardState | null } | null>(getWizard, [], null);
  return {
    read: value !== null,
    // The fallback is for the one case the file can be missing with the read landed: it was cleared in
    // another tab. Setup then starts recording again from this step rather than refusing to move.
    saved: (step) => ({ ...(value?.state ?? { mode, step }), step }),
  };
}

export function WizardView({ mode, start, snapshot, bump, onOpened, onExit }: Props) {
  const [step, setStep] = useState<WizardStart>(start);
  const { busy, error, run } = useAction();

  // ENDING SETUP IS DELETING THE FILE, and finishing and abandoning are the same act on disk — its
  // absence is what stops the wizard being offered on the next open. Skip is the third way out and the
  // one that KEEPS the file, which is the whole of what "resumable later" means here. decision 76.
  const endSetup = (): void => {
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
  else if (step === 'form')
    body = <FormStep mode={mode} snapshot={snapshot} onContinue={() => setStep('handoff')} />;
  else body = <HandoffStep />;

  return (
    <Stack fill scroll justify="center" align="start" pad={[7, 6]}>
      <Surface variant="raised" className="wizard-card">
        {body}
        <Stack gap={4} wrap>
          {/* The way out of every step, quiet and always there. At the end it is the only thing left to
              press, so it stops being a skip and ENDS setup rather than leaving it. */}
          {step === 'handoff' ? (
            <Button variant="primary" disabled={busy !== null} onClick={endSetup}>
              Take me to the board
            </Button>
          ) : (
            <Button onClick={onExit}>Not now — take me to the board</Button>
          )}
          {/* Only where there is a file to delete AND setup is not already over. Nothing is written until
              the scaffold, so the identity step has nothing to stop offering — and if another project
              happens to be open, its file is not this setup's to delete. At the handoff step the button
              above has just done this, and two endings on one screen read as a choice between them. */}
          {step !== 'identity' && step !== 'handoff' && (
            <Button variant="bare" disabled={busy !== null} onClick={endSetup}>
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
  const { read, saved } = useSaved(mode);
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
            it, which is the whole of why the check is here rather than at the first dispatch. `read`
            is the second gate and has nothing to do with the machine: see `useSaved`. */}
        <Button variant="primary" disabled={!ready || !read || busy !== null} onClick={go}>
          Continue
        </Button>
      </Stack>
      {error && <Text role="error">{error}</Text>}
    </>
  );
}

// THE KINDS IN WORDS. `BOX_KINDS` is machinery — it picks which image a box is built from — and its
// members are slugs for that reason; these are the same three choices said the way somebody choosing
// between them would say them. One map, here, rather than labels invented at each site.
const KIND_LABELS: Record<BoxKind, string> = {
  web: 'Web App',
  game: 'Game',
  research: 'Research',
};

// A cleared number box gives `Number('') === NaN`, which `JSON.stringify` puts on the wire as `null` and
// the endpoint refuses with a sentence about a key the person never touched. Clamped at source, exactly
// as AutopilotPanel clamps it: a box that cannot express an invalid value needs no refusal.
const atLeast = (text: string, min: number): number => {
  const n = Number(text);
  return Number.isFinite(n) ? Math.max(min, n) : min;
};

// THE AUTO-PILOT BAR'S EXACT RULE, copied rather than re-derived — `chooseMode` in AutopilotBar.tsx.
// The focus is cleared WITH the mode and only with it: `FocusPicker` renders in express alone and the
// tick honours a focus whatever the mode says, so a focus left behind on a switch to standard would
// confine the loop to one feature through a control nobody can see any more. The bar returns early on an
// unchanged mode, which is the other half of the rule — a mode that did not change keeps its focus.
function withMode(ap: AutopilotConfig, mode: LifecycleMode): AutopilotConfig {
  if (mode === ap.mode) return ap;
  const { focus: _dropped, ...rest } = ap;
  return { ...rest, mode };
}

// WHAT THE PROJECT IS, IN THE PERSON'S OWN WORDS, and the two choices that are not questions at all.
//
// The three answers go to the wizard's own file, because they are what the copilot will be told and not
// something the product enforces. The two choices go to `config.yaml`, because they change what the
// machine does: the kind decides which image a box is built from, and the lifecycle decides how coarsely
// auto-pilot breaks work down. Two stores, one press — and each block is sent WHOLE.
//
// EVERYTHING AN ENGINEER WANTS IS BEHIND ONE FOLD (W8). A beginner never meets a package list or a
// dollar cap, and an engineer does not have to leave setup to set them.
function FormStep({
  mode,
  snapshot,
  onContinue,
}: {
  mode: ScaffoldMode;
  snapshot: ProjectSnapshot | null;
  onContinue: () => void;
}) {
  const { read, saved } = useSaved(mode);
  const [what, setWhat] = useState('');
  const [who, setWho] = useState('');
  const [done, setDone] = useState('');
  const ap = snapshot?.config.autopilot;
  const [kind, setKind] = useState<BoxKind>(snapshot?.config.box?.kind ?? 'web');
  const [lifecycle, setLifecycle] = useState<LifecycleMode>(ap?.mode ?? 'standard');
  // Prefilled from what the project already has, and it matters: the patch REPLACES the box block, so a
  // field that started empty on a project with packages would delete them on the way past.
  const [packages, setPackages] = useState(csv(snapshot?.config.box?.packages ?? []));
  const [budgetUsd, setBudget] = useState(ap?.budgetUsd ?? 0);
  const [maxIterations, setMax] = useState(ap?.maxIterations ?? 1);
  const { busy, error, run } = useAction();

  const go = (): void => {
    void run(async () => {
      await putWizard({ ...saved('handoff'), answers: { what, who, done } });
      const extra = parseCsv(packages);
      await patchConfig({
        box: { kind, ...(extra.length > 0 ? { packages: extra } : {}) },
        // Nothing written for a project with no lifecycle block: `PATCH /api/config` checks the block it
        // is given against the board, and one assembled here from nothing would fail every check at once.
        ...(ap ? { autopilot: { ...withMode(ap, lifecycle), budgetUsd, maxIterations } } : {}),
      });
      onContinue();
    });
  };

  return (
    <>
      <Text as="h2" size="title" ink="strong" family="display">
        A few questions
      </Text>
      <Text role="hint">
        Nothing here is binding — it is what your assistant reads before it starts, so a rough answer beats a
        blank one.
      </Text>

      <Field label="What are you making?" hint="A sentence or two, in your own words.">
        <Control as="textarea" rows={3} value={what} onChange={(e) => setWhat(e.target.value)} />
      </Field>
      <Field label="Who is it for?">
        <Control as="textarea" rows={2} value={who} onChange={(e) => setWho(e.target.value)} />
      </Field>
      <Field label={'What does "done" look like?'} hint="How you'll know the first version works.">
        <Control as="textarea" rows={2} value={done} onChange={(e) => setDone(e.target.value)} />
      </Field>

      {/* `as="div"`, because what the label names is a picker and not a form element — a wrapping
          `<label>` would have nothing to focus and would read the whole group out as its name. */}
      <Field as="div" label="What kind of project is it?">
        <Tabs
          grouped
          label="What kind of project is it?"
          value={kind}
          onChange={(next) => setKind(next as BoxKind)}
          items={BOX_KINDS.map((value) => ({ value, label: KIND_LABELS[value] }))}
        />
      </Field>

      <Field
        as="div"
        label="How carefully should it work?"
        hint="Express plans in bigger pieces — about a third of the cost. Standard is more thorough."
      >
        {/* The same picker the auto-pilot bar carries, reading the mode chosen here rather than the one
            on disk: this screen has not saved anything yet. */}
        <LifecyclePicker
          config={ap ? { ...ap, mode: lifecycle } : null}
          onChange={(next) => setLifecycle(next as LifecycleMode)}
        />
      </Field>

      <details>
        <summary>For engineers</summary>
        <Stack direction="column" gap={4} pad={[4, 0, 0]}>
          <Field
            label="Extra packages"
            hint="Debian package names, comma-separated — they'll be installed into every sandbox this project gets."
          >
            <Control value={packages} onChange={(e) => setPackages(e.target.value)} />
          </Field>
          {ap && (
            <>
              <Field
                label="Budget (USD)"
                hint="Auto-pilot stops when this project's runs have cost this much. Zero means no dollar budget."
              >
                <Control
                  type="number"
                  min={0}
                  step={1}
                  value={budgetUsd}
                  onChange={(e) => setBudget(atLeast(e.target.value, 0))}
                />
              </Field>
              <Field
                label="Iteration cap"
                hint="How many times auto-pilot may dispatch in one run. This is what bounds a project with no dollar budget."
              >
                <Control
                  type="number"
                  min={1}
                  step={10}
                  value={maxIterations}
                  onChange={(e) => setMax(atLeast(e.target.value, 1))}
                />
              </Field>
            </>
          )}
        </Stack>
      </details>

      <Stack gap={4}>
        {/* Gated on the read for `useSaved`'s reason: this step's write is the one that would drop the
            resumes a later phase stores beside these answers. */}
        <Button variant="primary" disabled={!read || busy !== null} onClick={go}>
          Continue
        </Button>
      </Stack>
      {error && <Text role="error">{error}</Text>}
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
