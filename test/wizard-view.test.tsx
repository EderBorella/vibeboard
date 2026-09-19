// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../src/store/project/config.js';
import type { SandboxState } from '../web/src/lib/api.js';
import type { ProjectConfig, ProjectSnapshot } from '../web/src/lib/shared.js';

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

    await waitFor(() => expect(result.current[0]).toEqual({ mode: 'brownfield', step: 'form' }));
  });

  it('asks nothing with no project open, and nothing before signing in', () => {
    root(undefined);
    renderHook(() => useWizard(false, '/work/demo'));

    expect(api.getWizard).not.toHaveBeenCalled();
  });

  it('does not offer again until a DIFFERENT project opens, so a skip holds', async () => {
    api.getWizard.mockResolvedValue({ state: { mode: 'greenfield', step: 'backend' } });
    const { result, rerender } = root('/work/one');
    await waitFor(() => expect(result.current[0]?.mode).toBe('greenfield'));

    // The skip. Every later render of the same project — a card moved, a snapshot pushed — must leave it
    // skipped, which is what keying on the root rather than on a counter buys.
    act(() => result.current[1](null));
    rerender({ at: '/work/one' });
    expect(result.current[0]).toBeNull();
    expect(api.getWizard).toHaveBeenCalledTimes(1);

    rerender({ at: '/work/two' });
    await waitFor(() => expect(result.current[0]?.mode).toBe('greenfield'));
    expect(api.getWizard).toHaveBeenCalledTimes(2);
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
