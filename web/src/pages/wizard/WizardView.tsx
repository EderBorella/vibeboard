import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../atoms/Button';
import { Control } from '../../atoms/Control';
import { Pulse } from '../../atoms/Pulse';
import { Readout } from '../../atoms/Readout';
import { Stack } from '../../atoms/Stack';
import { Surface } from '../../atoms/Surface';
import { Text } from '../../atoms/Text';
import {
  acknowledgeGates,
  buildAgentImage,
  type ControlGroup,
  clearWizard,
  getControlFile,
  getReadiness,
  getWizard,
  listControlFiles,
  patchConfig,
  putWizard,
  readFsFile,
  runWizardSkill,
  type SandboxState,
  scaffoldProject,
  setAuthority,
} from '../../lib/api';
import {
  type AutopilotConfig,
  BOX_KINDS,
  type BoxKind,
  type LifecycleMode,
  type ProjectSnapshot,
  type ScaffoldMode,
  type WizardAnswers,
  type WizardState,
  type WizardStep,
} from '../../lib/shared';
import { useAction } from '../../lib/useAction';
import { useBuildLog } from '../../lib/useBuildLog';
import { useConfirm } from '../../lib/useConfirm';
import { useFetched } from '../../lib/useFetched';
import { useSandbox } from '../../lib/useSandbox';
import type { WizardStart } from '../../lib/useWizard';
import { csv, parseCsv, projectTarget, slugify, toNamePattern } from '../../lib/viewmodel';
import { useSharedWs } from '../../lib/ws';
import { Field } from '../../molecules/Field';
import { Notice } from '../../molecules/Notice';
import { Tabs } from '../../molecules/Tabs';
import { LifecyclePicker } from '../../organisms/autopilot/LifecyclePicker';
import { useReadiness } from '../../organisms/autopilot/useReadiness';
import { BackendPicker } from '../../organisms/copilot/BackendPicker';
import { clampToCaps, resolveChoice } from '../../organisms/copilot/choice';
import { ThinkingIndicator } from '../../organisms/copilot/ThinkingIndicator';
import { useCopilot } from '../../organisms/copilot/useCopilot';

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
// path is what was typed — NOT `projectTarget`, which builds a path out of a parent and a name and
// would, for a folder whose name is not already a slug, name a directory that does not exist.
//
// THE DERIVED NAME IS A SUGGESTION AND NOT A GATE. It used to blank the path when it came out empty,
// which is what a folder with no ASCII letters in its name does — so `/work/日本語` gave an absolute
// path, no complaint about it, and a button that did nothing when pressed. The name is a field now and
// the two answers are independent: this one only proposes.
function adoptTarget(input: string): { relative: boolean; path: string; name: string } {
  const path = input.replace(/\/+$/, '');
  const relative = path !== '' && !path.startsWith('/');
  return { relative, path: relative ? '' : path, name: slugify(path.split('/').pop() ?? '') };
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
  failed: boolean;
  retry: () => void;
  saved: (step: WizardStep) => WizardState;
} {
  const [tries, setTries] = useState(0);
  const { value, failed } = useFetched<{ state: WizardState | null } | null>(getWizard, [tries], null);
  return {
    read: value !== null,
    // The read REJECTING is the pending case's twin: the gate above rightly stays shut, but a gate
    // that stays shut with nothing on screen and no way to ask again strands setup on one hiccup —
    // the same hole the live check had, closed the same way.
    failed,
    retry: () => setTries((n) => n + 1),
    // The fallback is for the one case the file can be missing with the read landed: it was cleared in
    // another tab. Setup then starts recording again from this step rather than refusing to move.
    saved: (step) => ({ ...(value?.state ?? { mode, step }), step }),
  };
}

// One rendering for the read's failure, shared by the two steps that gate on it.
function ReadFailed({ retry, busy }: { retry: () => void; busy: boolean }) {
  return (
    <>
      <Notice as="p" tone="warn">
        We could not read where you were up to. Nothing is lost.
      </Notice>
      <Button disabled={busy} onClick={retry}>
        Ask again
      </Button>
    </>
  );
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

  // WHAT THE SCAN HAD TO SAY FOR ITSELF, read on the screen it hands over to rather than on its own:
  // a run that could not finish is news about the QUESTIONS — some of them will be blank — and the
  // step that produced it is unmounted by the time anybody could read it there.
  const [scanNotice, setScanNotice] = useState<string>();
  // Stable across renders, because the scan step subscribes to the socket with it in a dependency
  // list: an inline arrow here would tear that subscription down and rebuild it on every render.
  const leaveScan = useCallback((notice?: string) => {
    setScanNotice(notice);
    setStep('form');
  }, []);
  // Stable for the same reason: the stack step's socket subscription is keyed on the identity of what
  // it is handed, and an inline arrow would rebuild it on every render.
  const leaveForm = useCallback(() => setStep('stack'), []);
  const leaveStack = useCallback(() => setStep('docs'), []);
  const leaveGates = useCallback(() => setStep('handoff'), []);

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
    body = <BackendStep mode={mode} snapshot={snapshot} bump={bump} onContinue={setStep} />;
  else if (step === 'scan') body = <ScanStep mode={mode} bump={bump} onContinue={leaveScan} />;
  else if (step === 'form')
    body = <FormStep mode={mode} snapshot={snapshot} notice={scanNotice} onContinue={leaveForm} />;
  else if (step === 'stack')
    body = <StackStep mode={mode} snapshot={snapshot} bump={bump} onContinue={leaveStack} />;
  else if (step === 'docs')
    body = <DocsStep mode={mode} snapshot={snapshot} bump={bump} onContinue={setStep} />;
  else if (step === 'gates') body = <GatesStep mode={mode} onContinue={leaveGates} />;
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
  // `null` is "nobody has typed a name", which is not the same as an empty one: bringing a folder in
  // proposes the folder's own name, and a person who clears the box has chosen to clear it.
  const [name, setName] = useState<string | null>(null);
  const [repo, setRepo] = useState('');
  const { busy, error, run } = useAction();

  const greenfield = mode === 'greenfield';
  const folder = adoptTarget(repo);
  const typed = name ?? (greenfield ? '' : folder.name);
  const nameSlug = slugify(typed);
  const target = greenfield
    ? { ...projectTarget(parent, nameSlug), name: nameSlug }
    : { relative: folder.relative, path: folder.path, name: nameSlug };

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
          ? 'Creates the folder, the board, and the private workspace your assistant will work inside. That workspace is prepared the first time and reused after that.'
          : 'Adds the board and your assistant’s own workspace beside what is already there. Your files stay where they are.'}
      </Text>

      {greenfield ? (
        <Field label="Location (parent folder)">
          <Control
            value={parent}
            placeholder="/path/to/projects"
            onChange={(e) => setParent(e.target.value)}
          />
        </Field>
      ) : (
        <Field label="Folder (full path)" hint="The folder that holds the project you want to bring in.">
          <Control
            value={repo}
            placeholder="/path/to/your-project"
            onChange={(e) => setRepo(e.target.value)}
          />
        </Field>
      )}
      {/* ASKED IN BOTH MODES, and bringing a folder in is the half that was missing: its name was
          derived from the last segment of the path and never shown, so the first place anyone could
          read it was the top bar of a project that already existed. Prefilled with that derivation
          rather than replacing it — the proposal is right almost always, and where it is not there is
          now somewhere to say so. */}
      <Field label="Name (dash-separated, lowercase)" error={error}>
        <Control
          value={typed}
          placeholder="my-project"
          onChange={(e) => setName(toNamePattern(e.target.value))}
        />
      </Field>

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
        {/* BOTH ANSWERS, SEPARATELY. A path with no name and a name with no path are different things
            missing, and the fields that hold them are both on screen — which is what the one merged
            condition could not say when it was the folder that had failed to yield a name. */}
        <Button variant="primary" disabled={busy !== null || !target.path || !target.name} onClick={create}>
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
  docker: 'Almost — the workspace it runs in is not ready',
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
  // WHICH step is next is this one's to say, because it is the mode that decides it and the mode is
  // here. The file and the screen then move together — a Continue that wrote one step and showed
  // another is a setup you cannot resume into.
  onContinue: (next: WizardStep) => void;
}) {
  const { read, failed: readFailed, retry, saved } = useSaved(mode);
  // Re-asked on entry, after the assistant changes, and after a build lands: all three change the
  // answer, and none of them is observable any other way. `useSandbox` re-fetches on whatever it is
  // keyed to, which is this counter and nothing else on the screen.
  const [asked, setAsked] = useState(0);
  // `failed` is the read REJECTING, which is a different answer from the machine refusing: the probe
  // keeps its last value on a failure, and the value here starts null — so without this the step sits
  // on "Checking…" under a Continue that can never enable, with nothing on screen to press.
  const { sandbox, failed } = useSandbox(asked);
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
      // MAP MODE READS WHAT IS ALREADY THERE before it asks anything: almost every answer the next
      // screen wants is written down in the folder being brought in. A new project has nothing to
      // read, so it goes straight to the questions. decision 77.
      const next: WizardStep = mode === 'brownfield' ? 'scan' : 'form';
      await putWizard(saved(next));
      onContinue(next);
    }, 'continue');
  };

  return (
    <>
      <Text as="h2" size="title" ink="strong" family="display">
        Is the assistant ready?
      </Text>
      <Text role="hint">
        Your project's work is done by an assistant that runs on this machine, in a workspace of its own. This
        is a live check that one can actually start.
      </Text>

      {copilot && (
        <BackendPicker
          label="Which assistant runs your project"
          value={copilot.backend}
          disabled={busy !== null}
          onChange={choose}
        />
      )}

      {readFailed && <ReadFailed retry={retry} busy={busy !== null} />}
      {sandbox === null && !failed && <Text role="hint">Checking…</Text>}
      {failed && (
        <>
          <Notice as="p" tone="warn">
            We could not run the check just now. Nothing you have chosen is lost.
          </Notice>
          <Button disabled={busy !== null} onClick={() => setAsked((n) => n + 1)}>
            Try again
          </Button>
        </>
      )}
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
              the gate's.
              THE HANDLE IS WHY IT CAN NAME A COMMAND. Every other word on this screen is swept for the
              nine engineer's words a beginner should never meet (W7); this line is exempt BY ELEMENT,
              because these words are not this screen's to choose. */}
          <Notice as="p" tone="warn" testId="verbatim-reason">
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

// WHAT THE SCAN SAYS FOR ITSELF, and both of these are read on the next screen rather than this one.
// A run that could not finish is news about the QUESTIONS — some of them will be blank — and holding
// somebody on a report about a run they never asked for is the worse of the two evils.
const SCAN_UNFINISHED = 'I couldn’t read everything — the blanks are yours.';
const SCAN_REFUSED = 'I couldn’t read your files this time — the questions below are all yours.';

// THE FIRST AGENT MOMENT, AND IT ONLY HAPPENS IN MAP MODE: what the next screen asks for is mostly
// already written down in the folder the person is bringing in. A run reads it and fills the form in —
// as SUGGESTIONS, into empty fields only, which is the whole of what decision 77 lets an agent that
// has read an unvetted folder do.
//
// EVERY WAY OUT OF THIS SCREEN LEADS TO THE SAME PLACE. The run settling, the run failing, the door
// refusing and the person skipping all arrive at the questions; the only difference between them is
// whether anything is said about it. The form works identically with and without suggestions, which is
// what makes that safe.
function ScanStep({
  mode,
  bump,
  onContinue,
}: {
  mode: ScaffoldMode;
  bump: number;
  onContinue: (notice?: string) => void;
}) {
  const { read, failed: readFailed, retry, saved } = useSaved(mode);
  // The run this screen started, `null` until the door answers — and the subscription's key: every run
  // on this project broadcasts on one socket, and a frame about another one is not this step's news.
  const [runId, setRunId] = useState<string | null>(null);
  // ONE DISPATCH PER VISIT. An effect runs twice under StrictMode and again on every state change it
  // causes, and each extra run of this one is a real agent costing real money.
  const started = useRef(false);
  // The TAB's socket generation, threaded from the shell for the reason the build log is: `socketFor`
  // is last-write-wins, so a literal here would replace the app's own connection rather than share it.
  const ws = useSharedWs(bump);
  // Already scanned. Coming back here — Back from the questions, or resuming setup tomorrow — must not
  // spend another run to produce the suggestions the file already holds.
  const scanned = saved('scan').suggested !== undefined;

  useEffect(() => {
    // Gated on the READ and not merely on the mount: the answer to "has this already been scanned" is
    // on disk, and a dispatch fired before it lands is exactly the second run `scanned` prevents.
    if (!read || started.current) return;
    started.current = true;
    if (scanned) {
      onContinue();
      return;
    }
    runWizardSkill('scan-project')
      .then(({ run }) => setRunId(run.run))
      // Every refusal reads the same way here, and the 404 is the one that will actually happen: a
      // project part-way through setup when this arrived has no such skill, because `seedSkills` only
      // writes into an absent folder. There is nothing to do about any of them but ask the person.
      .catch(() => onContinue(SCAN_REFUSED));
  }, [read, scanned, onContinue]);

  useEffect(() => {
    if (runId === null) return;
    return ws.subscribe((msg) => {
      if (msg.type !== 'run:update') return;
      const record = msg.record as { run?: string; status?: string; outcome?: string } | undefined;
      if (record?.run !== runId) return;
      if (record.status === 'running' || record.status === 'queued') return;
      // ANYTHING BUT A CLEAN SUCCESS IS SAID PLAINLY. `outcome` is the agent's own word and is absent
      // entirely on a run that never wrote a report, so "is it a success" is the honest question —
      // asking whether it is `attention` would let a crash hand over silently.
      //
      // STRAIGHT OVER, with no read of its own. There was one, and its answer was discarded: the run
      // posts its prefill BEFORE the record this frame carries, and the questions read the file for
      // themselves on the way in and again at Continue. All the wait bought was a round trip between
      // a run ending and the person seeing anything.
      onContinue(record.outcome === 'success' ? undefined : SCAN_UNFINISHED);
    });
  }, [ws, runId, onContinue]);

  return (
    <>
      {readFailed ? (
        <ReadFailed retry={retry} busy={false} />
      ) : (
        <>
          <Stack gap={3}>
            <Pulse />
            {/* THE LIVE REGION IS THE SENTENCE, not the dots — ThinkingIndicator's reason, and the
                same shape: three dots are not information and each is aria-hidden. */}
            <span role="status">
              <Text>Reading your files…</Text>
            </span>
          </Stack>
          <Text role="hint">A minute or two. You can skip this and answer everything yourself.</Text>
        </>
      )}
      <Stack gap={4}>
        {/* THE WAY PAST A RUN THAT IS TAKING TOO LONG, and it leaves the run alone deliberately: what
            it finds still lands in the file, and the questions are the same questions either way. */}
        <Button onClick={() => onContinue()}>Skip and answer them myself</Button>
      </Stack>
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

// A cleared number box reads as `''`, and `Number('')` is 0 — below every minimum here, so what turns it
// into the minimum is the clamp and not the guard. The guard is for the one thing `Number` returns that
// is neither a number nor a refusal: an exponent big enough to overflow gives `Infinity`, which
// `JSON.stringify` puts on the wire as `null` and the endpoint refuses with a sentence about a key the
// person never touched. Clamped at source, exactly as AutopilotPanel clamps it: a box that cannot
// express an invalid value needs no refusal.
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
  notice,
  onContinue,
}: {
  mode: ScaffoldMode;
  snapshot: ProjectSnapshot | null;
  // What the step before had to say for itself, when a scan ran and could not finish. Absent in
  // every other case, including a scan that went perfectly.
  notice?: string;
  onContinue: () => void;
}) {
  const { read, failed: readFailed, retry, saved } = useSaved(mode);
  const state = saved('stack');
  // WHAT THIS PERSON HAS TYPED, and an absent key is "they have not touched this box" — which is not
  // the same as an empty one, and is the only thing that can tell a cleared field from an unvisited
  // one. IdentityStep's idiom, and here it is also what lets a value arriving with the file reach a
  // box that was mounted before the read landed.
  const [typed, setTyped] = useState<Partial<Record<keyof WizardAnswers, string>>>({});
  const ap = snapshot?.config.autopilot;
  // `null` until a tab is pressed, for the same reason: without it the suggested kind could never win
  // over the default every scaffolded project is written with.
  const [chosenKind, setKind] = useState<BoxKind | null>(null);
  const [lifecycle, setLifecycle] = useState<LifecycleMode>(ap?.mode ?? 'standard');
  // Prefilled from what the project already has, and it matters: the patch REPLACES the box block, so a
  // field that started empty on a project with packages would delete them on the way past.
  const [packages, setPackages] = useState(csv(snapshot?.config.box?.packages ?? []));
  const [budgetUsd, setBudget] = useState(ap?.budgetUsd ?? 0);
  const [maxIterations, setMax] = useState(ap?.maxIterations ?? 1);
  const { busy, error, run } = useAction();

  // WHAT THE PERSON SAID WINS, ALWAYS. A suggestion fills a field only where the file holds no answer
  // for it, and the `||` is deliberate over `??`: an answer saved as an empty string is a field
  // somebody cleared, which is exactly where a proposal is welcome. decision 77.
  const answered = state.answers ?? {};
  const proposed = state.suggested?.answers ?? {};
  const value = (key: keyof WizardAnswers): string => typed[key] ?? (answered[key] || proposed[key] || '');
  const suggested = (key: keyof WizardAnswers): boolean =>
    typed[key] === undefined && !answered[key] && Boolean(proposed[key]);
  // Said on the field it applies to rather than once at the top: which of the three was filled in for
  // them is the whole of what a person needs to know here, and a banner cannot say it.
  const hintFor = (key: keyof WizardAnswers, own?: string): string | undefined =>
    suggested(key) ? 'Suggested from your files — edit anything wrong.' : own;
  const write = (key: keyof WizardAnswers, next: string): void =>
    setTyped((all) => ({ ...all, [key]: next }));
  // A kind the product does not have is a real answer from a scan — `kind` is a free string for that
  // reason — so it is looked up rather than cast, and an unknown one leaves the project's own.
  const kind: BoxKind =
    chosenKind ?? BOX_KINDS.find((k) => k === state.suggested?.kind) ?? snapshot?.config.box?.kind ?? 'web';

  const go = (): void => {
    void run(async () => {
      // THE FILE AS IT STANDS AT THE PRESS, not as it stood when this screen opened. The scan step
      // hands over the moment its run settles and the run posts what it found into this same file,
      // so a suggestion can land while somebody is typing — and `putWizard` replaces the file whole.
      // The stack step's settle-read, taken here because this step has no run of its own to watch.
      const latest = await getWizard()
        .then((r) => r.state ?? undefined)
        .catch(() => undefined);
      await putWizard({
        ...(latest ?? state),
        step: 'stack',
        answers: { what: value('what'), who: value('who'), done: value('done') },
      });
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

      {readFailed && <ReadFailed retry={retry} busy={busy !== null} />}
      {/* The step before's news, if it had any: a scan that could not finish is a fact about the boxes
          below, so it is read here rather than on the screen that produced it. */}
      {notice && (
        <Notice as="p" tone="warn">
          {notice}
        </Notice>
      )}

      <Field label="What are you making?" hint={hintFor('what', 'A sentence or two, in your own words.')}>
        <Control
          as="textarea"
          rows={3}
          value={value('what')}
          onChange={(e) => write('what', e.target.value)}
        />
      </Field>
      <Field label="Who is it for?" hint={hintFor('who')}>
        <Control as="textarea" rows={2} value={value('who')} onChange={(e) => write('who', e.target.value)} />
      </Field>
      <Field
        label={'What does "done" look like?'}
        hint={hintFor('done', "How you'll know the first version works.")}
      >
        <Control
          as="textarea"
          rows={2}
          value={value('done')}
          onChange={(e) => write('done', e.target.value)}
        />
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

// WHAT THE STACK RUN HAD TO SAY FOR ITSELF, and both are read on this screen rather than the next one:
// with no proposal there is still something to do here, which is name one.
const STACK_UNFINISHED = 'I couldn’t work one out — name your own below.';
const STACK_REFUSED = 'I couldn’t ask this time — name your own below.';

// WHAT THE RUN IS TOLD. The answers come from the FILE and the kind from the CONFIG, because that is
// where the step before wrote each of them — a copy carried through the browser would be a second thing
// to keep in step, and it would be empty on a setup resumed in a new tab. decision 77.
function stackPrompt(answers: WizardAnswers | undefined, kind: string): string {
  const a = answers ?? {};
  return [
    'The person answered the setup questions like this:',
    '',
    `- What it is: ${a.what || '(not answered)'}`,
    `- Who it is for: ${a.who || '(not answered)'}`,
    `- What done looks like: ${a.done || '(not answered)'}`,
    `- The kind of project: ${kind}`,
  ].join('\n');
}

// THE SECOND AGENT MOMENT, AND IT IS A STEP RATHER THAN A FIELD IN THE FORM (W9). What a project should
// be built with is a question most people setting one up cannot answer and a model usually can — so it
// is proposed rather than asked, on a screen whose whole shape is "here is a suggestion, and your word
// beats it".
//
// IT IS SETTLED BEFORE THE DOCUMENTS ARE WRITTEN, which is the point of it being here. The agreement is
// what the copilot is briefed with on the next step and what the box is built to install, and both of
// those are decisions that cannot be taken back cheaply once something has started running.
function StackStep({
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
  const { read, failed: readFailed, retry, saved } = useSaved(mode);
  // THE FILE AS THIS SCREEN LAST SAW IT, and the entry read is not it for long: the run posts its
  // proposal INTO the file while this step is on screen. `putWizard` replaces the file whole, so a
  // Continue built from the read taken on entry would delete the very suggestion it is agreeing to.
  const [fresh, setFresh] = useState<WizardState>();
  // The run this screen started, `null` until the door answers — and the subscription's key, because
  // every run on the project broadcasts on one socket and another one settling is not this step's news.
  const [runId, setRunId] = useState<string | null>(null);
  // ONE DISPATCH PER VISIT, for the scan step's reason: an effect runs twice under StrictMode and each
  // extra run of this one is a real agent costing real money.
  const started = useRef(false);
  // Whether there is anything to decide yet. False only while a run is still choosing.
  const [answered, setAnswered] = useState(false);
  const [notice, setNotice] = useState<string>();
  // The person's own sentence. Empty until they type, and it beats the proposal the moment they do.
  const [own, setOwn] = useState('');
  // `undefined` is "nobody has touched this box" — FormStep's idiom, and here it is what lets a list
  // that arrives with the run reach a field mounted long before it.
  const [typed, setTyped] = useState<string>();
  const ws = useSharedWs(bump);
  const { busy, error, run } = useAction();

  const state: WizardState = { ...(fresh ?? saved('docs')), step: 'docs' };
  // The kind the form wrote, read back from the config rather than carried here.
  const kind = snapshot?.config.box?.kind ?? 'web';
  // What is on the table: a stack already agreed — coming back to this screen — or the one the run
  // proposed. Either is the person's to overrule below.
  const proposal = state.stack ?? state.suggested?.stack;
  const agreed = own.trim() || proposal;
  const packages = typed ?? csv(state.suggested?.packages ?? snapshot?.config.box?.packages ?? []);
  // Parsed once: the sentence in the body and what the button writes to the config are the same
  // list, and two readings of one box is how a screen ends up promising what it does not do.
  const installs = parseCsv(packages);
  const prompt = stackPrompt(state.answers, kind);

  useEffect(() => {
    // Gated on the READ and not merely on the mount: whether this has been answered already is on
    // disk, and a dispatch fired before that lands spends a run to propose what the file holds.
    if (!read || started.current) return;
    started.current = true;
    if (proposal !== undefined) {
      setAnswered(true);
      return;
    }
    runWizardSkill('suggest-stack', prompt)
      .then(({ run: record }) => setRunId(record.run))
      // Every refusal reads the same way, and the 404 is the one that will actually happen: a project
      // part-way through setup when this arrived has no such skill, because `seedSkills` only writes
      // into an absent folder. There is nothing to do about any of them but ask the person.
      .catch(() => {
        setNotice(STACK_REFUSED);
        setAnswered(true);
      });
  }, [read, proposal, prompt]);

  // The run posts what it chose through `PUT /api/wizard/prefill` on its way out, so the handover waits
  // on a read of the file rather than racing one — and that read is what the write below carries.
  const finish = useCallback(async (ok: boolean): Promise<void> => {
    const next = await getWizard()
      .then((r) => r.state ?? undefined)
      .catch(() => undefined);
    if (next) setFresh(next);
    // A run can end tidily having proposed nothing at all, which is the same news to this screen as a
    // run that crashed: there is nothing to agree with, so say so and ask.
    if (!ok || next?.suggested?.stack === undefined) setNotice(STACK_UNFINISHED);
    setAnswered(true);
  }, []);

  useEffect(() => {
    if (runId === null) return;
    return ws.subscribe((msg) => {
      if (msg.type !== 'run:update') return;
      const record = msg.record as { run?: string; status?: string; outcome?: string } | undefined;
      if (record?.run !== runId) return;
      if (record.status === 'running' || record.status === 'queued') return;
      // `outcome` is the agent's own word and is absent entirely on a run that never wrote a report,
      // so "is it a success" is the honest question — the scan step's reasoning, and the same shape.
      void finish(record.outcome === 'success');
    });
  }, [ws, runId, finish]);

  const go = (): void => {
    void run(async () => {
      await putWizard({ ...state, ...(agreed ? { stack: agreed } : {}) });
      await patchConfig({ box: { kind, ...(installs.length > 0 ? { packages: installs } : {}) } });
      onContinue();
    });
  };

  return (
    <>
      {readFailed && <ReadFailed retry={retry} busy={busy !== null} />}
      {!readFailed && !answered && (
        <>
          <Stack gap={3}>
            <Pulse />
            {/* The live region is the sentence and not the dots, for ThinkingIndicator's reason. */}
            <span role="status">
              <Text>Choosing a stack that fits…</Text>
            </span>
          </Stack>
          <Text role="hint">A minute or two. You can skip this and name your own.</Text>
          <Stack gap={4}>
            {/* The way past a run that is taking too long, and it leaves the run alone deliberately:
                what it finds still lands in the file, and the box below is answerable either way. */}
            <Button onClick={() => setAnswered(true)}>Skip and name it myself</Button>
          </Stack>
        </>
      )}
      {!readFailed && answered && (
        <>
          <Text as="h2" size="title" ink="strong" family="display">
            What it will be built with
          </Text>
          <Text role="hint">
            A suggestion from your answers, not a decision. Anything you write below is used instead.
          </Text>
          {notice && (
            <Notice as="p" tone="warn">
              {notice}
            </Notice>
          )}
          {/* THE MODEL'S OWN SENTENCE, WHOLE. It is shown precisely so it can be argued with, and a
              wizard that reworded it would be second-guessing the thing it is asking about. Every
              other word on this screen is swept for the nine engineer's words a beginner should never
              meet (W7); this line is exempt BY ELEMENT, as the probe's refusal is. */}
          {proposal && (
            <Text as="p" testId="verbatim-stack">
              {proposal}
            </Text>
          )}
          {/* WHAT THE BOX WILL ACTUALLY INSTALL, IN THE BODY. It is the only suggestion on this
              screen with a machine effect — every sandbox this project gets is built with these,
              while the stack sentence is read by a model and by nobody else — and it was visible
              only inside a fold that is closed until somebody opens it. Read from the FIELD rather
              than from `suggested`, so it stays true the moment the list is edited. The names are
              the model's, so the line is exempt from the plain-words sweep by element as the
              proposal above it is. */}
          {installs.length > 0 && (
            <Text as="p" testId="verbatim-packages">
              It will also install: {installs.join(', ')}
            </Text>
          )}
          <Field label="Or name your own stack" hint="A sentence is enough — it is read, not parsed.">
            <Control as="textarea" rows={2} value={own} onChange={(e) => setOwn(e.target.value)} />
          </Field>
          {/* Everything an engineer wants behind one fold (W8), exactly as the questions do it — and
              it is the same list the form offered, prefilled now with what the run worked out. */}
          <details>
            <summary>For engineers</summary>
            <Stack direction="column" gap={4} pad={[4, 0, 0]}>
              <Field
                label="What the sandbox installs"
                hint="Debian package names, comma-separated — they'll be installed into every sandbox this project gets."
              >
                <Control value={packages} onChange={(e) => setTyped(e.target.value)} />
              </Field>
            </Stack>
          </details>
          <Stack gap={4}>
            {/* Nothing to agree to is a real state — a run can end having proposed nothing — and this
                is the one press that decides what the next step is briefed with. `read` gates it for
                `useSaved`'s reason: this write replaces the file. */}
            <Button variant="primary" disabled={!read || !agreed || busy !== null} onClick={go}>
              Use this stack
            </Button>
          </Stack>
        </>
      )}
      {error && <Text role="error">{error}</Text>}
    </>
  );
}

// THE ONE SENTENCE THE BROWSER SENDS. Everything the model actually needs — the voice contract, the
// answers, the agreed stack, where the résumés go — is composed on the SERVER at the credential seam
// (`wizardFrame`), because a brief the browser sends is a brief the browser can edit, and it would
// land in the person's own transcript on the way past. decision 77.
const KICKOFF = "Please set up this project's documents from my answers.";

// How often the summaries are re-read while a turn is writing them. See the effect that uses it.
const RESUME_POLL_MS = 3_000;

// THE SIX DOCUMENTS, IN WORDS (W7). A filename is the one thing a beginner cannot act on, and this
// screen is where they first meet these — so the wizard names them the way somebody would say them
// out loud, and the filename stays on the surfaces that open the file. The order is the order they
// are written and the order they are listed in.
const DOC_NAMES: Record<string, string> = {
  'README.md': 'The introduction',
  'STACK.md': 'The stack',
  'CODE-QUALITY.md': 'Quality gates',
  'TESTING.md': 'Testing',
  'UX.md': 'How it feels',
  'DESIGN.md': 'How it looks',
};

// WHERE A DOCUMENT'S TEXT COMES FROM, and it is two doors because the six documents live in two
// places. The five foundation documents are control files, opened by the path the LISTING gives —
// the server's fact, never a copy of the layout kept in the browser, exactly as the gates step opens
// them. The README is at the project root and is not a control file at all, so it is read through
// the explorer, which is the door every other project file is read through.
async function documentText(name: string, path: string | undefined): Promise<string | null> {
  if (name === 'README.md') {
    const file = await readFsFile(name);
    return file.kind === 'text' ? file.content : null;
  }
  return path ? (await getControlFile(path)).content : null;
}

// ONE DOCUMENT: WHAT IT IS, IN A SENTENCE, AND THE DOCUMENT ITSELF ONE PRESS AWAY (decision 78).
// A person asked to review six documents they did not write will read none of them, so the summary
// is the card and the file is the offer — and the filename appears only once the file is open, which
// is the one view it is a fact about.
function DocumentCard({
  name,
  summary,
  path,
  running,
}: {
  name: string;
  summary?: string;
  path?: string;
  // Whether a turn is writing right now, which is what makes a missing summary a different fact.
  running: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { value: text } = useFetched<string | null>(
    async () => (open ? await documentText(name, path) : null),
    [open, path],
    null,
  );
  return (
    <Surface variant="inset" data-testid="doc-card">
      <Stack direction="column" gap={3}>
        <Text ink="strong">{DOC_NAMES[name] ?? name}</Text>
        {summary === undefined ? (
          // AN ABSENCE HAS TO BE ON THE SCREEN. Rendering only what was written turns a six-document
          // project with three summaries into a three-document project, and the person reviewing it
          // cannot know what they were never shown.
          <Text as="p" role="hint">
            {running ? 'Being written…' : 'No summary yet — ask for one in the chat'}
          </Text>
        ) : (
          <>
            {/* The model's own words, rendered whole — exempt from the plain-words sweep by element,
                as the stack proposal is. */}
            <Text as="p" role="hint" testId="verbatim-resume">
              {summary}
            </Text>
            <Stack gap={4}>
              <Button onClick={() => setOpen(!open)}>{open ? 'Hide it again' : 'Read it all'}</Button>
            </Stack>
          </>
        )}
        {open && (
          <Stack direction="column" gap={3}>
            {/* THE FILENAME, HERE AND NOWHERE ELSE ON THE CARD: this is the view that is about the
                file, and somebody who will later go looking for it needs to have met its name once. */}
            <Text ink="strong">{name}</Text>
            {/* The document is the model's text too, and thicker than any summary — a CODE-QUALITY.md
                is a list of commands. Exempt by element for the summary's reason. Read-only and
                monospaced, as the gates step shows a document: this screen must not invite editing. */}
            <Stack direction="column" gap={3} testId="verbatim-document">
              <Control as="textarea" mono readOnly rows={12} aria-label={name} value={text ?? 'Opening…'} />
            </Stack>
          </Stack>
        )}
      </Stack>
    </Surface>
  );
}

// THE FULL SET, ALWAYS, IN THE ORDER THE DOCUMENTS ARE WRITTEN. A summary that has not been filed is
// a card that says so rather than a card that is missing. A name the file carries that this product
// does not know can only arrive by hand-editing `wizard.yaml` — it is shown last, under its filename,
// for `Unwritten`'s reason: an unknown document is still a document.
function DocumentCards({ resumes, running }: { resumes: Record<string, string>; running: boolean }) {
  const { value: groups } = useFetched(listControlFiles, [], NO_GROUPS);
  const files = groups.find((group) => group.key === 'foundation')?.files ?? [];
  const names = [...Object.keys(DOC_NAMES), ...Object.keys(resumes).filter((name) => !(name in DOC_NAMES))];
  // NOTHING AT ALL UNTIL THE WRITING HAS BEGUN — a turn running, or something already filed. Six
  // cards saying "no summary yet" under an offer to write them is a list of things that do not exist.
  // Asked here rather than at the call site: the step that renders this has a complexity budget, and
  // "is there anything to show" is a question about the cards.
  if (!running && names.every((name) => resumes[name] === undefined)) return null;
  return (
    <>
      {names.map((name) => (
        <DocumentCard
          key={name}
          name={name}
          summary={resumes[name]}
          path={files.find((file) => file.name === name)?.path}
          running={running}
        />
      ))}
    </>
  );
}

// WHAT ACTUALLY HAPPENED, when it was not what the heading promised. Counted rather than listed in
// the sentence and then named in words underneath: the count is the news, the names are what to do
// about it. Its own component for `GateDocument`'s reason — the step it renders inside has a
// complexity budget, and this is a self-contained reading of one fact.
function Unwritten({ names, busy, onRetry }: { names: string[]; busy: boolean; onRetry: () => void }) {
  return (
    <>
      <Notice as="p" tone="warn">
        {names.length === 1
          ? 'It didn’t finish — one of the documents is still unwritten.'
          : `It didn’t finish — ${names.length} of the documents are still unwritten.`}
      </Notice>
      <Text as="p">{names.map((name) => DOC_NAMES[name] ?? name).join(', ')}</Text>
      <Stack gap={4}>
        <Button variant="primary" disabled={busy} onClick={onRetry}>
          Try again
        </Button>
      </Stack>
    </>
  );
}

// THE THIRD AGENT MOMENT, AND IT IS THE COPILOT AND NOT A RUN (W3). Writing a README and five guiding
// documents out of three answers is a conversation — the person is in it, and the next phase puts them
// side by side with it. What this step is, on its own, is the honest minimum: ask, authorise, send one
// turn, and show that something is happening until it stops.
//
// THE CONVERSATION IS THE APP'S, not this screen's: `useCopilot` is keyed to the tab's socket
// generation, so the turn sent here is the same conversation the dock shows, with the same transcript
// on the server.
function DocsStep({
  mode,
  snapshot,
  bump,
  onContinue,
}: {
  mode: ScaffoldMode;
  snapshot: ProjectSnapshot | null;
  bump: number;
  // WHICH step is next is this one's to say, because the answer is the readiness the turn just
  // changed. The FILE is this step's to move too, and it is a fresh read that moves it — see
  // `leave` below: the copilot writes its summaries into the file while the turn runs, so the copy
  // read on entry is stale by exactly the thing this step produced.
  onContinue: (next: WizardStep) => void;
}) {
  const { read, failed: readFailed, retry, saved } = useSaved(mode);
  const { confirm, dialog } = useConfirm();
  const { items, running, send, cancel, sentAt, lastEventAt } = useCopilot(bump);
  const [sent, setSent] = useState(false);
  // The summaries as the poll below last saw them. `undefined` is "not read since this screen
  // mounted", which falls back to the file's own — a setup resumed here shows what was written last
  // time rather than an empty list under a heading about writing.
  const [polled, setPolled] = useState<Record<string, string>>();
  // The documents the turn did not produce, or `undefined` for "the question has not been asked or
  // was answered yes". Never `[]`: an empty list and an unasked question are the same screen, and
  // keeping them one value means nothing can render the honest ending over nothing.
  const [unwritten, setUnwritten] = useState<string[]>();
  const started = useRef(false);
  // A turn that never began cannot have ended: `running` is false before the first frame, and an
  // ending read off that alone would walk the person off this screen the moment they authorised.
  const ran = useRef(false);
  // WHERE THIS TURN BEGINS IN THE TRANSCRIPT, and the transcript is the CONVERSATION'S — hydrated
  // from disk on connect, so an error item from days ago is in it before this screen mounts.
  // `failed` scanned the whole of it, and one of those marked every turn after it as failed.
  //
  // Mirrored through an effect rather than read out of `ask`'s closure: the offer is raised before
  // the answer, and anything arriving while the question is on screen belongs to neither turn.
  const committed = useRef(0);
  const mark = useRef(0);
  const { busy, error, run } = useAction();

  // Full-auto, clamped to what this assistant actually publishes — the model is writing files
  // unattended, which is the whole of what this step is. Nothing else is sent with the turn: the
  // config holds the assistant, the model and the effort, and the server falls back to them.
  const { mode: turnMode } = clampToCaps(resolveChoice(snapshot?.config.copilot, {}), 'bypassPermissions');
  const resumes = polled ?? saved('docs').resumes ?? {};
  // ALREADY WRITTEN FOR, and the question this screen opens with rewrites the README and all five
  // documents. Raising it over a project that has them is an offer to destroy work phrased as an
  // offer to start, so a resume lands on the summaries instead and asks nothing. Plan D replaces this
  // holding screen with the review layout — the résumé cards beside the conversation — and the person's
  // own button becomes the only way past.
  const written = read && Object.keys(saved('docs').resumes ?? {}).length > 0;

  const ask = useCallback(async (): Promise<void> => {
    const ok = await confirm({
      title: 'Let the assistant write the drafts?',
      body: 'It will write the README and five guiding documents for this project — through the product, for this conversation only. You review everything next.',
      action: 'Let it write',
    });
    if (!ok) return;
    await run(async () => {
      // AWAITED, AND THE ORDER IS THE POINT. The credential is minted per turn from the authority the
      // server holds when the turn arrives, so a turn that overtook the grant would run without one
      // and could not write a single foundation document. `setCopilotAuthority` on the hook is
      // fire-and-forget for a button that reflects a state; this is a sequence.
      await setAuthority(true);
      setUnwritten(undefined);
      mark.current = committed.current;
      send(KICKOFF, { mode: turnMode });
      setSent(true);
    });
  }, [confirm, run, send, turnMode]);

  useEffect(() => {
    // Waits for the project's own settings AND for the file. What the turn is sent WITH is read off
    // the snapshot; WHETHER to offer one at all is read off the summaries already on disk, and an
    // offer raised before that lands is the rewrite this step must not perform unasked.
    if (!snapshot || !read || started.current) return;
    started.current = true;
    if (!written) void ask();
  }, [snapshot, read, written, ask]);

  useEffect(() => {
    committed.current = items.length;
  }, [items.length]);

  // A READ PER TRANSCRIPT ITEM IS A READ PER TOOL CALL, and a turn that writes six documents makes
  // dozens of those — every one of them a request for a file that changes six times in as many
  // minutes. Keyed on the TURN instead: once when it starts, then on a clock while it runs.
  //
  // A CLOCK RATHER THAN THE RESULT AND USAGE EVENTS, which was the other candidate and is the one
  // that reads better on paper. It is backend-dependent: the Claude backend emits `usage` per
  // assistant message, so summaries would appear roughly as they land, but OpenCode emits it once —
  // so half the product would show an empty list for the whole turn and all six at the end. Three
  // seconds is far below the interval between documents and far above a burst.
  useEffect(() => {
    if (!running) return;
    const look = (): void => {
      void getWizard()
        .then(({ state }) => setPolled(state?.resumes ?? {}))
        .catch(() => {});
    };
    look();
    const timer = setInterval(look, RESUME_POLL_MS);
    return () => clearInterval(timer);
  }, [running]);

  // WHERE SETUP GOES NEXT, AND THE FILE SAYING SO. The step used to move the screen and write nothing,
  // so the file sat at `docs` after every exit but the last — and `wizardFrame` keys on that step, so
  // it prefixed every later conversation on the project with a brief about writing documents, and a
  // resume re-offered the rewrite.
  //
  // FROM A FRESH READ rather than the entry one, because the copilot files its summaries into this
  // file during the turn and `putWizard` replaces it whole. The stack step's settle-read exactly.
  //
  // A FAILED WRITE STILL ADVANCES: the documents exist, and holding somebody on the screen that offers
  // to write them again is the worse of the two — a file left at `docs` resumes onto the summaries.
  const leave = useCallback(
    async (next: WizardStep): Promise<void> => {
      const latest = await getWizard()
        .then((r) => r.state ?? undefined)
        .catch(() => undefined);
      await putWizard({ ...(latest ?? saved(next)), step: next }).catch(() => {});
      onContinue(next);
    },
    [onContinue, saved],
  );

  const finish = useCallback(async (): Promise<void> => {
    // ONE READ, THREE QUESTIONS, and it used to ask only the third. Writing CODE-QUALITY.md or
    // TESTING.md as an agent blocks auto-pilot until a person has read it (decision 51), and the
    // copilot has just been told to write both — but the same response also says whether the README
    // and the five documents are THERE, and a turn that died four documents in walked the person to
    // "that is setup done" over a project with none of them.
    //
    // A FAILED READ IS NOT EVIDENCE OF A MISSING DOCUMENT, so it hands over rather than accusing: the
    // question this asks is answerable again on the next screen, and holding somebody here over a
    // hiccup is the fault the machine check's own failure case names.
    const state = await getReadiness().catch(() => undefined);
    if (state) {
      // THE README IS NOT A FOUNDATION DOCUMENT and is answered by its own field, so a turn that
      // wrote all five and never touched it is a state `foundation.missing` cannot see. First,
      // because it is written first and read first.
      const missing = [...(state.readme.ok ? [] : ['README.md']), ...state.foundation.missing];
      if (missing.length > 0) {
        setUnwritten(missing);
        return;
      }
    }
    await leave((state?.unreviewedGates.length ?? 0) > 0 ? 'gates' : 'handoff');
  }, [leave]);

  useEffect(() => {
    if (running) {
      ran.current = true;
      return;
    }
    if (!ran.current) return;
    ran.current = false;
    void finish();
  }, [running, finish]);

  // A turn refused before it started — no credential, no assistant — arrives as an error and nothing
  // else: the server's own `copilot:state` never goes up, so nothing here would ever settle. The offer
  // comes back rather than leaving somebody on a screen with no control that does anything.
  const failed = sent && items.slice(mark.current).some((item) => item.kind === 'error');
  // The latest tool the model reached for, which is the one thing in a long turn that says WHAT it is
  // doing rather than that it is doing something.
  const tool = items.filter((item) => item.kind === 'tool').at(-1)?.toolName;

  // The holding screen, and only until this visit sends a turn of its own: `Carry on writing` is an
  // ordinary offer once accepted, and the turn it starts belongs on the writing screen.
  const holding = written && !sent;

  return (
    <>
      <Text as="h2" size="title" ink="strong" family="display">
        Writing it all down
      </Text>
      <Text role="hint">
        {holding
          ? 'These are already written. Read them below, ask for more, or carry on — nothing here is changed unless you ask for it.'
          : 'Your assistant writes the README and five short guiding documents from your answers. Where it has to guess, it says so in the document rather than guessing quietly.'}
      </Text>

      {readFailed && <ReadFailed retry={retry} busy={busy !== null} />}
      {running && <ThinkingIndicator sentAt={sentAt} lastEventAt={lastEventAt} onCancel={cancel} />}
      {/* ONE LINE, THE LATEST, as the build log shows itself on the machine check: what a person needs
          from a turn this long is evidence it is still moving, not the transcript. The word is the
          CLI'S — a tool name, not a sentence this screen wrote — so it is exempt from the plain-words
          sweep by element, exactly as the model's own proposal and summaries are. */}
      {tool && <Readout testId="verbatim-tool">{tool}</Readout>}
      {/* THE SUMMARIES AS THEY LAND, which is the only part of this a beginner can read while it
          runs. Whether there is anything to show yet is the cards' own question — see below. */}
      <DocumentCards resumes={resumes} running={running} />

      {failed && (
        <Notice as="p" tone="warn">
          Something went wrong while it was writing — you can ask it to try again.
        </Notice>
      )}
      {unwritten && <Unwritten names={unwritten} busy={busy !== null} onRetry={() => void ask()} />}
      {holding && (
        <Stack gap={4}>
          {/* The offer, put back deliberately rather than raised on arrival: the person asking for
              more writing knows what they have, and the effect above does not. */}
          <Button disabled={busy !== null} onClick={() => void ask()}>
            Carry on writing
          </Button>
          <Button variant="primary" disabled={busy !== null} onClick={() => void finish()}>
            Continue
          </Button>
        </Stack>
      )}
      {/* `unwritten` carries its own offer, and two primary buttons saying the same thing on one
          screen is a choice between them. */}
      {!holding && !unwritten && !running && (!sent || failed) && (
        <Stack gap={4}>
          <Button variant="primary" disabled={busy !== null} onClick={() => void ask()}>
            Write the drafts
          </Button>
        </Stack>
      )}
      {error && <Text role="error">{error}</Text>}
      {dialog}
    </>
  );
}

// The listing before it lands. A module constant for `useFetched`'s reason: a fresh literal is a new
// blank on every render.
const NO_GROUPS: ControlGroup[] = [];

// One gate document, opened where it was changed. The listing is what turns a document's NAME into its
// path — the block carries bare filenames, and where a foundation document lives is the server's fact
// rather than a copy of the layout kept in the browser.
function GateDocument({ name, path }: { name: string; path?: string }) {
  const { value } = useFetched<string | null>(
    async () => (path ? (await getControlFile(path)).content : null),
    [path],
    null,
  );
  if (value === null) return <Text role="hint">Opening…</Text>;
  // Read-only and monospaced: it is a file, and the one thing this screen must not invite is editing
  // the commands somebody is here to check.
  return <Control as="textarea" mono readOnly rows={12} aria-label={name} value={value} />;
}

// DECISION 51 IN THE WIZARD'S OWN VOICE. CODE-QUALITY.md carries the `gates:` commands and TESTING.md
// the `smoke:` one, and the server runs both OUTSIDE the sandbox as the person — so an agent rewriting
// either blocks auto-pilot until somebody has read it. The block is cleared by a person saying they
// have, and by nothing else; this is that moment, put where the change happened rather than left to a
// refused Start days later.
function GatesStep({ mode, onContinue }: { mode: ScaffoldMode; onContinue: () => void }) {
  // Asked again after the acknowledgement, and that second answer is what moves the screen on.
  const [asked, setAsked] = useState(0);
  const { saved } = useSaved(mode);
  const { readiness } = useReadiness(asked);
  const { value: groups } = useFetched(listControlFiles, [], NO_GROUPS);
  const { busy, error, run } = useAction();
  const names = readiness?.unreviewedGates ?? [];
  const files = groups.find((group) => group.key === 'foundation')?.files ?? [];
  // The listing is what turns a document's NAME into the path it is opened from; without one the
  // fold holds "Opening…" for ever, so the name is on the screen and the document is not.
  const pathFor = (name: string): string | undefined => files.find((file) => file.name === name)?.path;
  // WHETHER THERE IS ANYTHING TO HAVE READ. The press is a claim about what is on this screen and it
  // is the only thing that ever clears the block, so it waits for both reads: `?? []` above made the
  // button live for the round trip in which the screen named no documents and showed none. An
  // ANSWERED readiness naming nothing leaves it live deliberately — there is nothing to wait for, and
  // a resume onto a step whose block has since been cleared must still have a way forward.
  const openable = readiness !== null && names.every((name) => pathFor(name) !== undefined);
  // Once, whatever the effect below is re-run by. `leave` is rebuilt on every render — `saved` is —
  // so without this the write would repeat for as long as the parent took to unmount this step.
  const moved = useRef(false);

  // THE FILE MOVES WITH THE SCREEN, from a fresh read, for the docs step's reason: the summaries the
  // copilot filed are in the file rather than in this screen, and `putWizard` replaces it whole. A
  // setup finished through this step used to leave `docs` on disk, which is the step `wizardFrame`
  // keys on and the step a resume re-offers the rewrite from.
  const leave = useCallback(async (): Promise<void> => {
    const latest = await getWizard()
      .then((r) => r.state ?? undefined)
      .catch(() => undefined);
    await putWizard({ ...(latest ?? saved('handoff')), step: 'handoff' }).catch(() => {});
    onContinue();
  }, [onContinue, saved]);

  // ADVANCED BY THE ANSWER AND NOT BY THE PRESS. Acknowledging is the server's to accept, and a screen
  // that moved on before it answered would put somebody past a block that is still there — and the
  // next thing they press is Start.
  useEffect(() => {
    if (moved.current || asked === 0 || names.length > 0) return;
    moved.current = true;
    void leave();
  }, [asked, names.length, leave]);

  const acknowledge = (): void => {
    void run(async () => {
      await acknowledgeGates();
      setAsked((n) => n + 1);
    });
  };

  return (
    <>
      <Text as="h2" size="title" ink="strong" family="display">
        One thing to read before anything runs
      </Text>
      <Text role="hint">
        These files hold the commands your project will be judged by — and they run on your machine, as you.
        Read them once.
      </Text>
      {names.map((name) => (
        <details key={name}>
          <summary>{name}</summary>
          <Stack direction="column" gap={4} pad={[4, 0, 0]}>
            <GateDocument name={name} path={pathFor(name)} />
          </Stack>
        </details>
      ))}
      <Stack gap={4}>
        <Button variant="primary" disabled={busy !== null || !openable} onClick={acknowledge}>
          I've read them — carry on
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
        The next part needs the assistant, and it isn't built yet — everything you chose is saved.
      </Text>
    </>
  );
}
