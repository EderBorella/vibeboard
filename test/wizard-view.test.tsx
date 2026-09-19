// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../src/store/project/config.js';
import type { SandboxState } from '../web/src/lib/api.js';
import type { ProjectConfig, ProjectSnapshot, WizardState } from '../web/src/lib/shared.js';

const api = vi.hoisted(() => ({
  scaffoldProject: vi.fn().mockResolvedValue({ snapshot: {} }),
  putWizard: vi.fn().mockResolvedValue({ state: {} }),
  clearWizard: vi.fn().mockResolvedValue(undefined),
  getWizard: vi.fn().mockResolvedValue({ state: null }),
  // The backend step's three calls: the live check, the one remedy the product can carry out itself,
  // and the write that records which assistant was chosen.
  // A clean machine by default, so a test about something else does not have to describe one. The step
  // mounts with a live check whatever the test is about.
  getSandbox: vi
    .fn()
    .mockResolvedValue({ ok: true, backend: 'managed', agentRefusal: null, refusalKind: null }),
  buildAgentImage: vi.fn().mockResolvedValue({ ok: true, already: false }),
  patchConfig: vi.fn().mockResolvedValue({}),
}));
vi.mock('../web/src/lib/api.js', () => api);

// The shared socket, faked the way the REAL one is keyed: one object per `bump`, memoised. A fake that
// ignored its argument would un-gate the thing that matters here — that the build log is subscribed on
// the TAB's socket generation rather than on a literal, which `socketFor` would answer by replacing the
// tab's own connection.
const ws = vi.hoisted(() => {
  type Msg = { type: string; state?: string; line?: string };
  const subscribers = new Map<number, Set<(m: Msg) => void>>();
  const sockets = new Map<number, { subscribe: (fn: (m: Msg) => void) => () => void }>();
  const asked: number[] = [];
  const useSharedWs = (bump: number) => {
    asked.push(bump);
    const existing = sockets.get(bump);
    if (existing) return existing;
    const set = new Set<(m: Msg) => void>();
    subscribers.set(bump, set);
    const socket = {
      subscribe: (fn: (m: Msg) => void) => {
        set.add(fn);
        return () => set.delete(fn);
      },
    };
    sockets.set(bump, socket);
    return socket;
  };
  return {
    useSharedWs,
    asked,
    reset: () => {
      sockets.clear();
      subscribers.clear();
      asked.length = 0;
    },
    push: (msg: Msg, bump = 0) => {
      for (const fn of subscribers.get(bump) ?? []) fn(msg);
    },
  };
});
vi.mock('../web/src/lib/ws.js', () => ({ useSharedWs: ws.useSharedWs }));
vi.mock('../web/src/lib/ws', () => ({ useSharedWs: ws.useSharedWs }));

const { WizardView } = await import('../web/src/pages/wizard/WizardView.js');
const { useWizard } = await import('../web/src/lib/useWizard.js');

const onOpened = vi.fn();
const onExit = vi.fn();

// The identity step reads the snapshot as ONE BIT — is a project open — but every step after it reads
// the project's config, so the stub carries a real one: the same `defaultConfig` a scaffold writes, cast
// across the tsc/Vite seam the way the settings tests cast it.
const config = defaultConfig('demo') as unknown as ProjectConfig;
const opened = { name: 'demo', root: '/work/demo', config } as unknown as ProjectSnapshot;

const view = (over: Partial<ComponentProps<typeof WizardView>> = {}) =>
  render(
    <WizardView
      mode="greenfield"
      start="identity"
      snapshot={null}
      bump={0}
      onOpened={onOpened}
      onExit={onExit}
      {...over}
    />,
  );

const type = (label: RegExp, value: string): void => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};

// A read held open, so the window between mounting a step and its answer landing can be stood in
// rather than reasoned about. `mockResolvedValue` closes that window before the first assertion.
function deferred<T>(): { promise: Promise<T>; settle: (value: T) => Promise<void> } {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return {
    promise,
    settle: async (value) => {
      await act(async () => {
        resolve(value);
        await promise;
      });
    },
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  ws.reset();
});

// WHERE A NEW PROJECT GOES, and these assertions were the project gate's until the form became two
// doors. They move here whole rather than being rewritten, because the fault they pin is this form's
// wherever it stands: it concatenates a free-text parent folder with the name, so `data/projects` — one
// missing leading slash — asked the server to create `data/projects/calculator`. Node resolved that
// against the SERVER's working directory and the project was created inside the VibeBoard install:
// docker refused its box (a relative string is a volume NAME to `-v`), auto-pilot's pre-flight commit
// ran in VibeBoard's own repository and stopped a run over a failure in VibeBoard's test suite, and the
// project never got the `.git/hooks` pin its box relies on.
//
// The endpoint refuses it too, and that is the one that counts — this half is so the answer arrives
// before a request rather than as a 400 after it. Both are asserted, because the reason a person can
// see and the reason a machine enforces are different things and either can rot alone.
describe('the identity step, with no project yet', () => {
  it('will not create against a relative parent folder', () => {
    view();
    type(/location/i, 'data/projects');
    type(/^name/i, 'calculator');

    const create = screen.getByRole('button', { name: 'Create the project' }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.click(create);
    expect(api.scaffoldProject).not.toHaveBeenCalled();
  });

  it('says what is wrong rather than only refusing', () => {
    // A disabled button with no explanation is indistinguishable from a broken one — the person is one
    // character from a working path and cannot see which character.
    view();
    type(/location/i, 'data/projects');
    type(/^name/i, 'calculator');

    expect(screen.getByText(/absolute path/i)).toBeTruthy();
  });

  it('names its two boxes in full and shows the example each one needs', () => {
    // WHAT A CONTROL SAYS BESIDES ITS VALUE. A migration moves the wrapper and the thing it drops
    // silently is an attribute: a placeholder, a type, a bound. The value and the handler are asserted
    // above; these are the parts no other case here would miss.
    view();
    const box = (label: RegExp): HTMLInputElement => screen.getByLabelText(label) as HTMLInputElement;

    expect(screen.getByText('Location (parent folder)')).toBeTruthy();
    expect(screen.getByText('Name (dash-separated, lowercase)')).toBeTruthy();
    expect(box(/location/i).tagName).toBe('INPUT');
    expect(box(/location/i).placeholder).toBe('/path/to/projects');
    expect(box(/^name/i).tagName).toBe('INPUT');
    expect(box(/^name/i).placeholder).toBe('my-project');
  });

  it('asks its two questions even with another project already open', () => {
    // SWITCH PROJECT, THEN NEW PROJECT. The board stays open until the new one is scaffolded, so "is a
    // project open" is not the same question as "is the identity step behind us" — deriving the step
    // from the snapshot handed a person asking for a new project the step AFTER the one that makes it.
    view({ snapshot: opened });

    expect(screen.getByLabelText(/location/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create the project' })).toBeTruthy();
  });

  it('pushes the name toward the pattern as it is typed', () => {
    view();
    type(/^name/i, 'My Project');

    expect((screen.getByLabelText(/^name/i) as HTMLInputElement).value).toBe('my-project');
  });

  it('creates against an absolute parent, at the path it previews, and says which mode', async () => {
    view();
    type(/location/i, '/data/projects');
    type(/^name/i, 'calculator');

    expect(screen.getByText('/data/projects/calculator')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create the project' }));

    expect(api.scaffoldProject).toHaveBeenCalledWith('/data/projects/calculator', 'calculator', 'greenfield');
    // The file is written before the shell is told, so a project that opens with a wizard pending is
    // never a project whose wizard file has not landed yet.
    await waitFor(() => expect(api.putWizard).toHaveBeenCalledWith({ mode: 'greenfield', step: 'backend' }));
    expect(onOpened).toHaveBeenCalledTimes(1);
  });
});

// MAP MODE IS THE FIRST CALLER IN THE PRODUCT TO SEND `brownfield`. The mode has existed on the endpoint
// and in the scaffolder since adoption was removed from the gate; nothing in the browser has ever asked
// for it, so this assertion is the only thing standing between the door and a second greenfield.
describe('the identity step, bringing in a repository', () => {
  it('asks for one path and says what that path is', () => {
    view({ mode: 'brownfield' });

    expect(screen.getByText('Repository (full path)')).toBeTruthy();
    expect(screen.getByText('The folder that holds the project you want to bring in.')).toBeTruthy();
    // The two boxes of a new project are not asked for: the folder already exists and already has a name.
    expect(screen.queryByLabelText(/location/i)).toBeNull();
  });

  it('sends brownfield, and names the project after the folder it was given', async () => {
    view({ mode: 'brownfield' });
    type(/repository/i, '/work/My Repo/');

    fireEvent.click(screen.getByRole('button', { name: 'Bring it in' }));

    // The path is the folder AS TYPED with its trailing slash dropped — never rebuilt from the slug,
    // which for a folder whose name is not already one would name a directory that does not exist.
    expect(api.scaffoldProject).toHaveBeenCalledWith('/work/My Repo', 'my-repo', 'brownfield');
    await waitFor(() => expect(api.putWizard).toHaveBeenCalledWith({ mode: 'brownfield', step: 'backend' }));
  });

  it('will not bring in a relative path either', () => {
    view({ mode: 'brownfield' });
    type(/repository/i, 'work/my-repo');

    expect((screen.getByRole('button', { name: 'Bring it in' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/absolute path/i)).toBeTruthy();
  });
});

// SKIP KEEPS THE FILE AND ABANDON DELETES IT, which is the whole of what makes the wizard resumable: the
// absence of the file is the one durable fact, so the only way to stop being offered setup is to remove
// it. Two buttons, and the difference between them is one call.
describe('the two ways out', () => {
  it('skipping hands back to the shell and leaves the file alone', () => {
    view({ start: 'backend', snapshot: opened });

    fireEvent.click(screen.getByRole('button', { name: 'Not now — take me to the board' }));

    expect(onExit).toHaveBeenCalledTimes(1);
    expect(api.clearWizard).not.toHaveBeenCalled();
  });

  it('stopping deletes the file BEFORE it leaves', async () => {
    view({ start: 'backend', snapshot: opened });

    fireEvent.click(screen.getByRole('button', { name: 'Stop offering this' }));

    await waitFor(() => expect(onExit).toHaveBeenCalledTimes(1));
    expect(api.clearWizard).toHaveBeenCalledTimes(1);
    // Order, not just both: leaving first and deleting afterwards would race an unmount against a write.
    expect(api.clearWizard.mock.invocationCallOrder[0]).toBeLessThan(onExit.mock.invocationCallOrder[0]);
  });

  // FINISHING IS THE OTHER WAY THE FILE DIES, and it was the missing one: decision 76's row says the
  // state file is deleted on finish or abandon, so a finish that deleted nothing left the wizard being
  // offered for ever to somebody who had completed it.
  it('finishing deletes the file BEFORE it leaves, exactly as abandoning does', async () => {
    view({ start: 'handoff', snapshot: opened });

    fireEvent.click(screen.getByRole('button', { name: 'Take me to the board' }));

    await waitFor(() => expect(onExit).toHaveBeenCalledTimes(1));
    expect(api.clearWizard).toHaveBeenCalledTimes(1);
    expect(api.clearWizard.mock.invocationCallOrder[0]).toBeLessThan(onExit.mock.invocationCallOrder[0]);
  });

  it('offers no second ending at the last step', () => {
    // Completion IS the ending here, so `Stop offering this` would be a second button promising what
    // the first one has already done — and the two would read as a choice between them.
    view({ start: 'handoff', snapshot: opened });

    expect(screen.queryByRole('button', { name: 'Stop offering this' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Take me to the board' })).toBeTruthy();
  });

  it('does not offer to stop before there is anything to stop', () => {
    // Nothing has been written yet at the identity step — the file lands with the scaffold — so a button
    // promising never to ask again would be promising about a file that does not exist.
    view();

    expect(screen.queryByRole('button', { name: 'Stop offering this' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Not now — take me to the board' })).toBeTruthy();
  });
});

describe('a refusal from the server', () => {
  it('lands under the field in the words the server used, and nothing throws', async () => {
    // Verbatim from `switchRefusal` in src/server/boards/project-routes.ts, which answers 409: creating a
    // project opens it, and opening one while auto-pilot is running is the switch it refuses.
    const refusal =
      'Auto-pilot is running in this project. Soft-stop it before opening or creating another one.';
    api.scaffoldProject.mockRejectedValueOnce(new Error(refusal));
    view();
    type(/location/i, '/data/projects');
    type(/^name/i, 'calculator');

    fireEvent.click(screen.getByRole('button', { name: 'Create the project' }));

    expect(await screen.findByText(refusal)).toBeTruthy();
    // The step is still standing, with the answers still in it.
    expect((screen.getByLabelText(/^name/i) as HTMLInputElement).value).toBe('calculator');
    expect(api.putWizard).not.toHaveBeenCalled();
    expect(onOpened).not.toHaveBeenCalled();
  });
});

// WHO OPENS THE WIZARD WITHOUT BEING ASKED. A project whose file is still on disk is setup half-done, so
// opening it offers to finish — and the dependency that decides WHEN is the whole of the hook: keyed on
// the shell's `bump` (which signing in, a backend change and a forgiven run all pull) it would re-offer
// the wizard seconds after a person skipped it.
describe('the offer to finish setup', () => {
  const root = (initial: string | undefined) =>
    renderHook(({ at }) => useWizard(true, at), { initialProps: { at: initial } });

  it('offers the mode the file names and resumes at the step it names', async () => {
    api.getWizard.mockResolvedValue({ state: { mode: 'brownfield', step: 'form' } });
    const { result } = root('/work/demo');

    await waitFor(() => expect(result.current.entry).toEqual({ mode: 'brownfield', step: 'form' }));
  });

  it('asks nothing with no project open, and nothing before signing in', () => {
    root(undefined);
    renderHook(() => useWizard(false, '/work/demo'));

    expect(api.getWizard).not.toHaveBeenCalled();
  });

  it('does not offer again until a DIFFERENT project opens, so a skip holds', async () => {
    api.getWizard.mockResolvedValue({ state: { mode: 'greenfield', step: 'backend' } });
    const { result, rerender } = root('/work/one');
    await waitFor(() => expect(result.current.entry?.mode).toBe('greenfield'));

    // The skip. Every later render of the same project — a card moved, a snapshot pushed — must leave it
    // skipped, which is what keying on the root rather than on a counter buys.
    act(() => result.current.leave());
    rerender({ at: '/work/one' });
    expect(result.current.entry).toBeNull();

    rerender({ at: '/work/two' });
    await waitFor(() => expect(result.current.entry?.mode).toBe('greenfield'));
  });

  // WHAT THE READINESS WALL ASKS, and it is a different question from "is the wizard on screen": a skip
  // keeps the file, so from the moment somebody skips there is a setup waiting that nothing is showing.
  it('keeps setup pending after a skip, and puts it back at the step the file names', async () => {
    api.getWizard.mockResolvedValue({ state: { mode: 'greenfield', step: 'form' } });
    const { result } = root('/work/one');
    await waitFor(() => expect(result.current.pending).toBe(true));

    act(() => result.current.leave());
    expect(result.current.entry).toBeNull();
    // Re-read on the way out, because the wizard reports neither of its two exits: the answer to which
    // one just happened is the file itself.
    await waitFor(() => expect(api.getWizard).toHaveBeenCalledTimes(2));
    expect(result.current.pending).toBe(true);
    // AND THAT READ MUST NOT PUT IT BACK. It finds the file the skip deliberately kept, so a read that
    // opened what it found would bounce the person straight back into the screen they just left — the
    // assertion above cannot see it, because it runs before the answer lands.
    expect(result.current.entry).toBeNull();

    act(() => result.current.resume());
    expect(result.current.entry).toEqual({ mode: 'greenfield', step: 'form' });
  });

  it('takes the offer away with the file when setup is abandoned', async () => {
    api.getWizard.mockResolvedValue({ state: { mode: 'greenfield', step: 'form' } });
    const { result } = root('/work/one');
    await waitFor(() => expect(result.current.pending).toBe(true));

    // `Stop offering this` deletes the file and then leaves, so the read on the way out finds nothing.
    api.getWizard.mockResolvedValue({ state: null });
    act(() => result.current.leave());

    await waitFor(() => expect(result.current.pending).toBe(false));
    act(() => result.current.resume());
    expect(result.current.entry).toBeNull();
  });

  // THE SCREEN AND THE HOOK OVER ONE FILE, and the fake is the file rather than either end's answer:
  // two doubles that each returned what their own side expected would agree with themselves and prove
  // nothing about the pair. The wizard's last button writes, the hook's read on the way out is what the
  // wall then believes, and the bug this pins lived exactly between them — finishing deleted nothing, so
  // a completed setup was offered again on every open for ever.
  it('stops being offered once setup is finished', async () => {
    let file: WizardState | null = { mode: 'greenfield', step: 'handoff' };
    api.getWizard.mockImplementation(async () => ({ state: file }));
    api.clearWizard.mockImplementation(async () => {
      file = null;
    });
    const { result } = root('/work/one');
    await waitFor(() => expect(result.current.pending).toBe(true));

    // Wired the way the shell wires it: the wizard's only report of leaving is `onExit`, and the shell's
    // handler is `setup.leave()`.
    view({ start: 'handoff', snapshot: opened, onExit: () => result.current.leave() });
    fireEvent.click(screen.getByRole('button', { name: 'Take me to the board' }));

    await waitFor(() => expect(result.current.pending).toBe(false));
    act(() => result.current.resume());
    expect(result.current.entry).toBeNull();
  });
});

// THE STEP THAT CANNOT BE ARGUED WITH (W2). The check is live, Continue is gated on it, and every
// refusal the probe can give arrives with the remedy that clears it — including the one remedy the
// product can carry out itself, which is a button here rather than a command in a terminal.
describe('the backend step', () => {
  // Verbatim from `REASON_EXPIRED` in src/server/boxes/credential-freshness.ts. The sentence on screen is
  // the probe's own, so the fixture is the probe's own too: a reason invented here from the description
  // would be wrong in exactly the way the code would be, and this file would still be green.
  const EXPIRED = [
    'the Claude Code sign-in on this machine has expired, so every agent turn would fail to authenticate.',
    'This project is set to the Claude Code backend; a project set to OpenCode is unaffected.',
    'Run "claude" in a terminal on the host to refresh it',
  ].join(' ');
  // From `probe` in src/server/boxes/box-manager.ts, both of them — one kind, two remedies.
  const NO_IMAGE = 'the agent image vibeboard-agent:latest is not built yet';
  const NO_DAEMON = 'Docker is not available — no daemon';

  const clear = (over: Partial<SandboxState> = {}): SandboxState => ({
    ok: true,
    backend: 'managed',
    agentRefusal: null,
    refusalKind: null,
    ...over,
  });
  // `agentRefusal` is composed the way `agentRefusal()` composes it, because the step reads THAT rather
  // than `ok` — a project attached to a server VibeBoard did not start answers `ok: true` and still
  // cannot run an agent.
  const refused = (
    refusalKind: NonNullable<SandboxState['refusalKind']>,
    reason: string,
    over: Partial<SandboxState> = {},
  ): SandboxState =>
    clear({ ok: false, reason, refusalKind, agentRefusal: `Agents are disabled: ${reason}.`, ...over });

  // What the step before left behind. `putWizard` REPLACES the state, so these answers are what proves
  // the step reads the file before it writes it.
  beforeEach(() => {
    api.getWizard.mockResolvedValue({
      state: { mode: 'greenfield', step: 'backend', answers: { what: 'a game' } },
    });
    api.getSandbox.mockResolvedValue(clear());
  });

  it('will not let you past a machine that cannot run an agent, and puts the fix on the screen', async () => {
    api.getSandbox.mockResolvedValue(refused('credential', EXPIRED));
    view({ start: 'backend', snapshot: opened });

    // The probe's sentence, whole: it is the only thing on the screen that names the command to run.
    expect(await screen.findByText(EXPIRED)).toBeTruthy();
    // The heading says what KIND of thing is being asked, which the server's sentence cannot: this one
    // is work outside the app, and the build below is work the app can do.
    expect(screen.getByText('Almost — one thing to do outside VibeBoard')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('opens the way on when the check comes back clean, and writes the file WHOLE', async () => {
    view({ start: 'backend', snapshot: opened });

    const go = await screen.findByRole('button', { name: 'Continue' });
    await waitFor(() => expect((go as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(go);

    // The answers survive a step that never asked for them. A write assembled from what this step knows
    // — `{ mode, step }` — would delete them, and nothing else in the wizard would notice.
    await waitFor(() =>
      expect(api.putWizard).toHaveBeenCalledWith({
        mode: 'greenfield',
        step: 'form',
        answers: { what: 'a game' },
      }),
    );
    expect(await screen.findByText('A few questions')).toBeTruthy();
  });

  // A WRITE RACING ITS OWN READ. `putWizard` replaces the file whole, and this step holds none of what
  // is in it, so a Continue pressed before the read lands writes `{ mode, step }` over the answers —
  // and over the resumes a later phase puts there. Nothing errors and nothing on screen changes; the
  // file is simply shorter afterwards.
  it('will not write until the file it is about to replace has been read', async () => {
    const read = deferred<{ state: WizardState | null }>();
    api.getWizard.mockReturnValue(read.promise);
    view({ start: 'backend', snapshot: opened });

    // The live check is the step's OTHER gate, and it has answered clean — so what is still holding
    // Continue down is the read and nothing else.
    await waitFor(() => expect(screen.getByText('Connected and ready.')).toBeTruthy());
    const go = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);

    await read.settle({ state: { mode: 'greenfield', step: 'backend', answers: { what: 'a game' } } });

    expect(go.disabled).toBe(false);
    fireEvent.click(go);
    await waitFor(() =>
      expect(api.putWizard).toHaveBeenCalledWith({
        mode: 'greenfield',
        step: 'form',
        answers: { what: 'a game' },
      }),
    );
  });

  it('offers to build when a build is what would fix it', async () => {
    api.getSandbox.mockResolvedValue(refused('docker', NO_IMAGE, { buildable: true }));
    view({ start: 'backend', snapshot: opened });

    expect(await screen.findByRole('button', { name: 'Build it now' })).toBeTruthy();
    expect(screen.getByText(NO_IMAGE)).toBeTruthy();
  });

  it('does not offer to build against a daemon that is not running', async () => {
    // The same refusal KIND with a different remedy. A button that cannot work is worse than no button:
    // it sends somebody to build an image on a machine where nothing can build anything.
    api.getSandbox.mockResolvedValue(refused('docker', NO_DAEMON));
    view({ start: 'backend', snapshot: opened });

    expect(await screen.findByText(NO_DAEMON)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Build it now' })).toBeNull();
  });

  it("streams the build over the tab's own socket and asks the machine again when it lands", async () => {
    api.getSandbox.mockResolvedValue(refused('docker', NO_IMAGE, { buildable: true }));
    view({ start: 'backend', snapshot: opened, bump: 7 });

    fireEvent.click(await screen.findByRole('button', { name: 'Build it now' }));
    await waitFor(() => expect(api.buildAgentImage).toHaveBeenCalledTimes(1));
    act(() => ws.push({ type: 'box:build', state: 'start', line: 'Step 3/9 : RUN apt-get update' }, 7));

    expect(await screen.findByText('Step 3/9 : RUN apt-get update')).toBeTruthy();
    // `socketFor` is last-write-wins: a literal key here would not open a second socket beside the tab's,
    // it would REPLACE it, and the board would stop receiving anything. Asked for the generation it was
    // handed, and for no other.
    expect(ws.asked).not.toHaveLength(0);
    expect(ws.asked.every((n) => n === 7)).toBe(true);
    // A finished build changes the answer, so the answer is asked for again.
    await waitFor(() => expect(api.getSandbox).toHaveBeenCalledTimes(2));
  });

  it('writes the WHOLE assistant block, and re-asks about the one just chosen', async () => {
    view({ start: 'backend', snapshot: opened });
    await waitFor(() => expect(api.getSandbox).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'OpenCode' }));

    // The whole block, not `{ backend }` alone: `backends` holds each assistant's remembered model, and
    // the per-assistant slots exist so one choice does not discard the other's.
    await waitFor(() =>
      expect(api.patchConfig).toHaveBeenCalledWith({
        copilot: { ...config.copilot, backend: 'opencode' },
      }),
    );
    // And the check beside it answers for the assistant just chosen rather than the one just left.
    await waitFor(() => expect(api.getSandbox).toHaveBeenCalledTimes(2));
  });
});

// THE QUESTIONS, AND THE TWO CHOICES THAT ARE NOT QUESTIONS (W6, W7, W8). Everything a beginner is asked
// is in their own words; everything an engineer wants is behind one fold. What the step writes is two
// stores at once — the answers to the wizard's own file, the two project choices to the config — and the
// config half has to carry each block WHOLE or the endpoint refuses it for a key the person never saw.
describe('the form step', () => {
  beforeEach(() => {
    api.getWizard.mockResolvedValue({ state: { mode: 'greenfield', step: 'form' } });
  });

  const form = (over: Partial<ProjectConfig> = {}) =>
    view({ start: 'form', snapshot: { ...opened, config: { ...config, ...over } } as ProjectSnapshot });

  // The lifecycle block a scaffolded project has. Asserted non-null because `defaultConfig` writes one:
  // the optional key is for projects made before the lifecycle existed, and a wizard never meets one.
  const lifecycle = config.autopilot!;

  it('writes the kind from the tab and the WHOLE lifecycle block', async () => {
    form();
    fireEvent.click(await screen.findByRole('button', { name: 'Game' }));
    fireEvent.click(screen.getByRole('button', { name: 'Express' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    // The whole block: `PATCH /api/config` runs the coverage check over the autopilot block it is
    // given, so a patch carrying one key fails every check that indexes the rest.
    await waitFor(() =>
      expect(api.patchConfig).toHaveBeenCalledWith({
        box: { kind: 'game' },
        autopilot: { ...lifecycle, mode: 'express' },
      }),
    );
  });

  it('drops a saved focus with the mode, exactly as the auto-pilot bar does', async () => {
    // `FocusPicker` renders in express alone and the tick honours a focus whatever the mode says, so a
    // focus left behind on a switch to standard confines the loop through a control nobody can see.
    const autopilot = { ...lifecycle, mode: 'express' as const, focus: 'F-001' };
    form({ autopilot });
    fireEvent.click(await screen.findByRole('button', { name: 'Standard' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(api.patchConfig).toHaveBeenCalled());
    const [[patch]] = api.patchConfig.mock.calls as [[{ autopilot: Record<string, unknown> }]];
    expect(patch.autopilot.mode).toBe('standard');
    expect('focus' in patch.autopilot).toBe(false);
  });

  it('keeps a focus the mode change never happened to', async () => {
    // The bar's other half: it returns early on an unchanged mode and never touches the focus. Leaving
    // the picker alone here must mean the same thing as not touching the bar at all.
    const autopilot = { ...lifecycle, mode: 'express' as const, focus: 'F-001' };
    form({ autopilot });
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(api.patchConfig).toHaveBeenCalledWith({ box: { kind: 'web' }, autopilot }));
  });

  it('parses the packages out of the line, and sends no packages key for an empty one', async () => {
    form();
    fireEvent.change(await screen.findByLabelText(/extra packages/i), {
      // The trailing comma is what a person leaves while typing; it must not become an empty package.
      target: { value: 'ffmpeg, imagemagick,' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() =>
      expect(api.patchConfig).toHaveBeenCalledWith(
        expect.objectContaining({ box: { kind: 'web', packages: ['ffmpeg', 'imagemagick'] } }),
      ),
    );

    cleanup();
    api.patchConfig.mockClear();
    form();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));

    // `mergeConfig` replaces the box block wholesale, so an empty key would be a promise about a list
    // nobody edited. Absent means "the image this kind implies", which is what a new project has.
    await waitFor(() =>
      expect(api.patchConfig).toHaveBeenCalledWith(expect.objectContaining({ box: { kind: 'web' } })),
    );
  });

  it('lands the three answers in the file, with everything already in it', async () => {
    api.getWizard.mockResolvedValue({
      state: { mode: 'brownfield', step: 'form', resumes: { 'foundation/TESTING.md': 'how it is checked' } },
    });
    form();
    fireEvent.change(await screen.findByLabelText(/what are you making/i), {
      target: { value: 'a tool for reading meters' },
    });
    fireEvent.change(screen.getByLabelText(/who is it for/i), { target: { value: 'the field team' } });
    fireEvent.change(screen.getByLabelText(/does "done" look like/i), {
      target: { value: 'one meter read end to end' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() =>
      expect(api.putWizard).toHaveBeenCalledWith({
        mode: 'brownfield',
        step: 'handoff',
        resumes: { 'foundation/TESTING.md': 'how it is checked' },
        answers: {
          what: 'a tool for reading meters',
          who: 'the field team',
          done: 'one meter read end to end',
        },
      }),
    );
  });

  // The same race as the backend step's, and this is the step where it costs the most: it writes the
  // three answers, so a press before the read lands would drop the resumes a later phase stores beside
  // them. Continue is the only control here, so nothing else can be holding it down.
  it('will not write until the file it is about to replace has been read', async () => {
    const read = deferred<{ state: WizardState | null }>();
    api.getWizard.mockReturnValue(read.promise);
    form();

    const go = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);

    await read.settle({
      state: { mode: 'greenfield', step: 'form', resumes: { 'foundation/TESTING.md': 'how it is checked' } },
    });

    expect(go.disabled).toBe(false);
    fireEvent.click(go);
    await waitFor(() =>
      expect(api.putWizard).toHaveBeenCalledWith({
        mode: 'greenfield',
        step: 'handoff',
        resumes: { 'foundation/TESTING.md': 'how it is checked' },
        answers: { what: '', who: '', done: '' },
      }),
    );
  });

  it('says nothing outside the fold that only an engineer would recognise', async () => {
    // A cheap W7 tripwire on the one surface in the product written for somebody who has never seen it.
    // The fold is exempt by name — it is labelled "For engineers" and is where those words belong.
    const { container } = form();
    await screen.findByRole('button', { name: 'Continue' });

    expect(container.querySelector('details')).not.toBeNull();
    const plain = container.cloneNode(true) as HTMLElement;
    for (const fold of plain.querySelectorAll('details')) fold.remove();
    expect(plain.textContent).not.toBe('');
    for (const jargon of ['config', 'yaml', 'backend', 'docker']) {
      expect(plain.textContent?.toLowerCase()).not.toContain(jargon);
    }
  });
});
