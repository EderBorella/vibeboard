// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FOUNDATION_FILES, foundationRel } from '../src/core/layout.js';
import { defaultConfig } from '../src/store/project/config.js';
import type { Readiness, SandboxState } from '../web/src/lib/api.js';
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
  // The wizard's own dispatch door. A card-less run is refused to this browser through `POST /api/runs`,
  // so setup's two runs have one of their own — see src/server/boards/wizard-routes.ts.
  runWizardSkill: vi.fn().mockResolvedValue({ run: { run: 'run-1', status: 'running' } }),
  // THE DOCS STEP'S FOUR. The grant the copilot writes the documents under; the question the wizard
  // asks the moment it stops — writing two of those documents as an agent is what raises it — and the
  // listing and the read the gate step opens each document's text with. A clean project by default, so
  // a test about the turn does not have to describe a block that is not there.
  setAuthority: vi.fn().mockResolvedValue({ authorised: true }),
  // Answered per test from `readiness()` below, which is the endpoint's REAL shape: the docs step
  // reads three of its fields and a fixture carrying one of them would pass the other two's check.
  getReadiness: vi.fn(),
  acknowledgeGates: vi.fn().mockResolvedValue({ ok: true }),
  listControlFiles: vi.fn().mockResolvedValue([]),
  getControlFile: vi.fn().mockResolvedValue({ content: '' }),
  // The README is not a control file — it lives at the project root — so the card that opens it goes
  // through the explorer's door instead. The two reads are different endpoints and this is the fake
  // for the second one.
  readFsFile: vi
    .fn()
    .mockResolvedValue({ kind: 'text', path: 'README.md', name: 'README.md', size: 0, content: '' }),
  // THE EMBEDDED PANEL'S OWN TWO, and they are here because the docs step renders the dock's organism
  // rather than a chat of its own (decision 78). An unmocked export of a mocked module is `undefined`,
  // so without these the review layout dies on the first render with "listModels is not a function".
  listModels: vi.fn().mockResolvedValue([]),
  getModelStatus: vi.fn().mockResolvedValue(null),
}));
vi.mock('../web/src/lib/api.js', () => api);

// The shared socket, faked the way the REAL one is keyed: one object per `bump`, memoised. A fake that
// ignored its argument would un-gate the thing that matters here — that the build log is subscribed on
// the TAB's socket generation rather than on a literal, which `socketFor` would answer by replacing the
// tab's own connection.
const ws = vi.hoisted(() => {
  // `record` is the run frame's payload, the shape `run:update` broadcasts. Typed loosely on purpose:
  // what the scan step reads off it is an id, a status and an outcome, and a fixture carrying a whole
  // RunRecord would hide which three of its fields the step actually depends on.
  type Msg = {
    type: string;
    // A string for a build frame and an object for the copilot's own state — the two frames this
    // socket carries that are not a run record, and the fake passes each through untouched.
    state?: string | { running: boolean };
    line?: string;
    record?: { run: string; status: string; outcome?: string };
    event?: { kind: string; name?: string; text?: string };
    // A REPLAYED TRANSCRIPT, which is how the dock's conversation arrives on connect: the copilot
    // channel replaces the client's items wholesale from what is on disk. Carried here because the
    // docs step's reading of "did this turn fail" is a question about WHICH items, and a fake that
    // could only append live ones could not put an old one in front of it.
    items?: { kind: string; text: string; toolName?: string }[];
    // The authority as the server reports it — pushed on connect and on every change, and the only
    // thing the browser knows about it.
    authorised?: boolean;
    chats?: unknown[];
    stats?: { costUsd: number; turns: number; lastDurationMs: number; contextTokens: number };
  };
  type Socket = { subscribe: (fn: (m: Msg) => void) => () => void; send: (payload: object) => void };
  const subscribers = new Map<number, Set<(m: Msg) => void>>();
  const sockets = new Map<number, Socket>();
  const asked: number[] = [];
  // WHAT THE TAB SENT. The docs step's turn goes UP this socket rather than through a route, so a fake
  // that only listened could not tell a turn sent from one merely prepared.
  const sent: object[] = [];
  const useSharedWs = (bump: number) => {
    asked.push(bump);
    const existing = sockets.get(bump);
    if (existing) return existing;
    const set = new Set<(m: Msg) => void>();
    subscribers.set(bump, set);
    const socket: Socket = {
      subscribe: (fn: (m: Msg) => void) => {
        set.add(fn);
        return () => set.delete(fn);
      },
      send: (payload: object) => {
        sent.push(payload);
      },
    };
    sockets.set(bump, socket);
    return socket;
  };
  return {
    useSharedWs,
    asked,
    sent,
    reset: () => {
      sockets.clear();
      subscribers.clear();
      asked.length = 0;
      sent.length = 0;
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
const { useCopilot } = await import('../web/src/organisms/copilot/useCopilot.js');

// jsdom implements no scrolling at all. The copilot transcript scrolls itself to the bottom on mount,
// and the documents step's review embeds that panel — so without this the review cannot render here.
// Nothing about scrolling is under test; test/work-area.test.tsx does the same for the same reason.
Element.prototype.scrollTo = Element.prototype.scrollTo ?? ((): void => {});

const onOpened = vi.fn();
const onExit = vi.fn();

// The identity step reads the snapshot as ONE BIT — is a project open — but every step after it reads
// the project's config, so the stub carries a real one: the same `defaultConfig` a scaffold writes, cast
// across the tsc/Vite seam the way the settings tests cast it.
const config = defaultConfig('demo') as unknown as ProjectConfig;
const opened = { name: 'demo', root: '/work/demo', config } as unknown as ProjectSnapshot;

// WHAT THE READINESS ENDPOINT ACTUALLY ANSWERS, whole. The docs step reads `unreviewedGates`,
// `foundation.missing` AND `readme.ok` from one response — "did it actually write anything" is the
// other half of "may auto-pilot start" — so a fixture carrying only the first would let the other two
// checks pass over fields that were never there. `present` is the real list for the same reason the
// probe fixtures are the probe's own.
const readiness = (over: Partial<Readiness> = {}): Readiness => ({
  ok: true,
  blockers: [],
  readme: { ok: true, path: 'README.md' },
  foundation: { present: FOUNDATION_FILES.map((f) => f.name), missing: [], ok: true },
  gates: { ok: true, count: 1 },
  smoke: { ok: true },
  phases: { problems: [], count: 6 },
  unreviewedGates: [],
  ...over,
});

// THE DOCK'S PROPS, exactly the set `WorkArea` hands `CopilotPanel`: the docs step embeds the same
// organism, so it takes the same ones. Inert handlers — what this file is about is the conversation,
// and the selects above it are the dock's own subject.
// NO `onClose`, because the shell stopped passing one: the review renders the panel `compact`, which
// has no header and therefore no ✕ to hide it with (W11).
const panel = {
  backend: 'claude-code',
  mode: 'bypassPermissions',
  model: 'sonnet',
  effort: 'medium',
  overridden: false,
  onMode: () => {},
  onModel: () => {},
  onEffort: () => {},
  onBackend: () => {},
  onReset: () => {},
};

// WHAT THE SHELL DOES, AND WHY IT IS A COMPONENT RATHER THAN A LITERAL. The conversation is a HOOK:
// App mounts ONE `useCopilot` for the tab and hands it to the dock and to setup alike, so a fixture
// object here would be a second transcript of one socket — the exact fault this phase went to remove.
// The real hook over the faked socket, keyed to the generation the view was handed, so `ws.asked`
// still answers for the whole tree.
function Shell({ over }: { over: Partial<ComponentProps<typeof WizardView>> }) {
  const bump = over.bump ?? 0;
  const copilot = useCopilot(bump);
  return (
    <WizardView
      mode="greenfield"
      start="identity"
      snapshot={null}
      onOpened={onOpened}
      onExit={onExit}
      {...over}
      bump={bump}
      copilot={{ copilot, ...panel }}
    />
  );
}

const view = (over: Partial<ComponentProps<typeof WizardView>> = {}) => render(<Shell over={over} />);

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

// A READY project by default. `clearAllMocks` clears the CALLS and leaves the implementation, so a
// case that describes a half-written project would otherwise be the answer for the rest of the file.
beforeEach(() => {
  api.getReadiness.mockResolvedValue(readiness());
});

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

    expect(screen.getByText('Folder (full path)')).toBeTruthy();
    expect(screen.getByText('The folder that holds the project you want to bring in.')).toBeTruthy();
    // Where a new project goes is not asked: the folder already exists and is the answer. Its NAME is
    // asked, prefilled from the path — see the two cases below.
    expect(screen.queryByLabelText(/location/i)).toBeNull();
  });

  it('sends brownfield, and names the project after the folder it was given', async () => {
    view({ mode: 'brownfield' });
    type(/^folder/i, '/work/My Repo/');

    fireEvent.click(screen.getByRole('button', { name: 'Bring it in' }));

    // The path is the folder AS TYPED with its trailing slash dropped — never rebuilt from the slug,
    // which for a folder whose name is not already one would name a directory that does not exist.
    expect(api.scaffoldProject).toHaveBeenCalledWith('/work/My Repo', 'my-repo', 'brownfield');
    await waitFor(() => expect(api.putWizard).toHaveBeenCalledWith({ mode: 'brownfield', step: 'backend' }));
  });

  // THE NAME IS A FIELD AND NOT A DERIVATION, and the reason is a button that died in silence: the
  // project's name was the folder's last segment slugified, so a folder whose name has no ASCII letters
  // in it derived the empty string — and the screen, with no name to show and nothing wrong with the
  // path to complain about, simply refused to do anything when pressed.
  it('asks for a name when the folder cannot give one, rather than refusing in silence', () => {
    view({ mode: 'brownfield' });
    type(/^folder/i, '/work/日本語');

    const bring = screen.getByRole('button', { name: 'Bring it in' }) as HTMLButtonElement;
    expect((screen.getByLabelText(/^name/i) as HTMLInputElement).value).toBe('');
    expect(bring.disabled).toBe(true);
    // Nothing is wrong with the path — it is absolute — so the one hint this screen has does not apply.
    expect(screen.queryByText(/absolute path/i)).toBeNull();

    type(/^name/i, 'meter-reader');

    expect(bring.disabled).toBe(false);
    fireEvent.click(bring);
    expect(api.scaffoldProject).toHaveBeenCalledWith('/work/日本語', 'meter-reader', 'brownfield');
  });

  it('shows the name it derived from the folder, and lets it be changed', () => {
    // It was derived and never shown, so the one place a person could learn what their project would be
    // called was the top bar after it had been created.
    view({ mode: 'brownfield' });
    type(/^folder/i, '/work/My Repo/');

    expect((screen.getByLabelText(/^name/i) as HTMLInputElement).value).toBe('my-repo');

    type(/^name/i, 'meters');
    fireEvent.click(screen.getByRole('button', { name: 'Bring it in' }));

    expect(api.scaffoldProject).toHaveBeenCalledWith('/work/My Repo', 'meters', 'brownfield');
  });

  it('will not bring in a relative path either', () => {
    view({ mode: 'brownfield' });
    type(/^folder/i, 'work/my-repo');

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
    view({ start: 'ready', snapshot: opened });

    fireEvent.click(screen.getByRole('button', { name: 'Open the board' }));

    await waitFor(() => expect(onExit).toHaveBeenCalledTimes(1));
    expect(api.clearWizard).toHaveBeenCalledTimes(1);
    expect(api.clearWizard.mock.invocationCallOrder[0]).toBeLessThan(onExit.mock.invocationCallOrder[0]);
  });

  it('offers no second ending at the last step', () => {
    // Completion IS the ending here, so `Stop offering this` would be a second button promising what
    // the first one has already done — and the two would read as a choice between them.
    view({ start: 'ready', snapshot: opened });

    expect(screen.queryByRole('button', { name: 'Stop offering this' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open the board' })).toBeTruthy();
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

  // SIGNING IN IS NOT OPENING A PROJECT, and the effect is keyed on both. `signedIn` flips false→true
  // on the sign-in re-bind the shell performs, and every flip re-ran the read AND re-opened what it
  // found — so a person who had skipped setup was put back inside it by an event that has nothing to
  // say about their project. The reviewer reproduced it; only a changed ROOT may re-offer.
  it('does not offer again when the same project is signed into a second time', async () => {
    api.getWizard.mockResolvedValue({ state: { mode: 'greenfield', step: 'backend' } });
    const { result, rerender } = renderHook(({ on, at }) => useWizard(on, at), {
      initialProps: { on: true, at: '/work/one' as string | undefined },
    });
    await waitFor(() => expect(result.current.entry?.mode).toBe('greenfield'));

    // The skip. The file stays, which is the point — so the read on the way back in finds it again.
    act(() => result.current.leave());
    await waitFor(() => expect(api.getWizard).toHaveBeenCalledTimes(2));
    expect(result.current.entry).toBeNull();

    rerender({ on: false, at: '/work/one' });
    rerender({ on: true, at: '/work/one' });

    await waitFor(() => expect(api.getWizard).toHaveBeenCalledTimes(3));
    await act(async () => {});
    expect(result.current.entry).toBeNull();
    // And the read still happened: `pending` is what the readiness wall asks, and it must stay true.
    expect(result.current.pending).toBe(true);
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
    let file: WizardState | null = { mode: 'greenfield', step: 'ready' };
    api.getWizard.mockImplementation(async () => ({ state: file }));
    api.clearWizard.mockImplementation(async () => {
      file = null;
    });
    const { result } = root('/work/one');
    await waitFor(() => expect(result.current.pending).toBe(true));

    // Wired the way the shell wires it: the wizard's only report of leaving is `onExit`, and the shell's
    // handler is `setup.leave()`.
    view({ start: 'ready', snapshot: opened, onExit: () => result.current.leave() });
    fireEvent.click(screen.getByRole('button', { name: 'Open the board' }));

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

  // THE READ'S OWN FAILURE — the pending case's twin, surfaced by the fix round. A rejection is not
  // evidence the file is absent, so the gate above stays shut; but a gate that stays shut with nothing
  // on screen and no way to ask again strands setup on one hiccup, exactly as the live check once did.
  it('says so and offers to ask again when reading where you were fails', async () => {
    api.getWizard.mockRejectedValueOnce(new Error('boom'));
    view({ start: 'backend', snapshot: opened });
    expect(await screen.findByText(/could not read where you were/i)).toBeTruthy();
    const go = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    api.getWizard.mockResolvedValue({ state: { mode: 'greenfield', step: 'backend' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask again' }));
    await waitFor(() => expect(go.disabled).toBe(false));
    expect(screen.queryByText(/could not read where you were/i)).toBeNull();
  });

  it('the form step carries the same way back up', async () => {
    api.getWizard.mockRejectedValueOnce(new Error('boom'));
    view({ start: 'form', snapshot: opened });
    expect(await screen.findByText(/could not read where you were/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ask again' })).toBeTruthy();
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

  // THE PROBE ITSELF FAILING IS NOT THE PROBE SAYING NO, and the step used to treat it as neither: a
  // rejected read left `sandbox` null for ever, so the screen said "Checking…" under a Continue that
  // could never enable and there was nothing to press.
  it('says so when the check cannot be run at all, and offers to ask again', async () => {
    api.getSandbox.mockRejectedValueOnce(new Error('the server is not answering'));
    view({ start: 'backend', snapshot: opened });

    expect(await screen.findByText(/could not run the check/i)).toBeTruthy();
    // Not still "Checking…", which reads as an answer on its way.
    expect(screen.queryByText('Checking…')).toBeNull();
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    // A real second ask, answered by the clean machine the beforeEach describes.
    await waitFor(() => expect(api.getSandbox).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Connected and ready.')).toBeTruthy();
    expect(screen.queryByText(/could not run the check/i)).toBeNull();
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

// THE FIRST AGENT MOMENT, and it only exists in map mode: almost every answer the next screen asks
// for is already written down in the folder the person is bringing in. A run reads it and fills the
// form in — as SUGGESTIONS, into empty fields only, which is the whole of what decision 77 lets an
// agent that has read an unvetted folder do.
describe('the scan step (map mode)', () => {
  // Re-stated per test, because `clearAllMocks` clears the CALLS and leaves the implementation: the
  // rejection one case below installs would otherwise be the door's answer for the rest of the file.
  beforeEach(() => {
    api.getWizard.mockResolvedValue({ state: { mode: 'brownfield', step: 'scan' } });
    api.runWizardSkill.mockResolvedValue({ run: { run: 'run-1', status: 'running' } });
  });

  const scan = () => view({ mode: 'brownfield', start: 'scan', snapshot: opened });

  // A `run:update` frame as the server broadcasts one, on the tab's own socket generation.
  const settle = async (status: string, outcome?: string, run = 'run-1'): Promise<void> => {
    await act(async () => {
      ws.push({ type: 'run:update', record: { run, status, ...(outcome ? { outcome } : {}) } });
    });
  };

  it('reads the folder through the wizard’s own door, and says what it is doing', async () => {
    scan();

    // ONE ARGUMENT, and the door takes no others: which skill is the only thing the browser chooses.
    await waitFor(() => expect(api.runWizardSkill).toHaveBeenCalledWith('scan-project'));
    expect(screen.getByText('Reading your files…')).toBeTruthy();
    expect(
      screen.getByText('A minute or two. You can skip this and answer everything yourself.'),
    ).toBeTruthy();
  });

  // RE-ENTRY MUST NOT RE-SCAN. The file already holds what the last run found, and a second run would
  // cost real money to produce the same suggestions over the answers the first one already made.
  it('does not read it twice: coming back with suggestions goes straight to the questions', async () => {
    api.getWizard.mockResolvedValue({
      state: { mode: 'brownfield', step: 'scan', suggested: { answers: { what: 'a timeline of releases' } } },
    });
    scan();

    expect(await screen.findByText('A few questions')).toBeTruthy();
    expect(api.runWizardSkill).not.toHaveBeenCalled();
  });

  // Nothing is dispatched until the file has been READ, for `useSaved`'s reason turned around: the
  // answer to "has this already been scanned" is on disk, and a dispatch fired before it lands is the
  // second run the case above exists to prevent.
  it('waits for the file before it starts anything', async () => {
    const read = deferred<{ state: WizardState | null }>();
    api.getWizard.mockReturnValue(read.promise);
    scan();

    expect(api.runWizardSkill).not.toHaveBeenCalled();

    await read.settle({ state: { mode: 'brownfield', step: 'scan' } });

    await waitFor(() => expect(api.runWizardSkill).toHaveBeenCalledWith('scan-project'));
  });

  it('hands over to the questions when the run has read what it can', async () => {
    scan();
    await waitFor(() => expect(api.runWizardSkill).toHaveBeenCalled());

    await settle('success', 'success');

    expect(await screen.findByText('A few questions')).toBeTruthy();
    expect(screen.queryByText(/blanks are yours/)).toBeNull();
  });

  // THE FRAME IS FILTERED TO THE RUN THIS STEP STARTED. Every run on the project broadcasts on this
  // socket — auto-pilot's, a run started from a card in another tab — and any of them settling would
  // otherwise walk the person off a scan that is still reading.
  it('ignores another run settling, and moves on when its own does', async () => {
    scan();
    await waitFor(() => expect(api.runWizardSkill).toHaveBeenCalled());

    await settle('success', 'success', 'some-other-run');
    expect(screen.getByText('Reading your files…')).toBeTruthy();

    await settle('success', 'success');
    expect(await screen.findByText('A few questions')).toBeTruthy();
  });

  // A run that ended in anything but a clean success still hands over: the questions are answerable
  // without it, and holding a person on a screen about a run they did not ask for is the worst of both.
  it('carries on with a plain notice when the run could not read everything', async () => {
    scan();
    await waitFor(() => expect(api.runWizardSkill).toHaveBeenCalled());

    await settle('attention', 'attention');

    expect(await screen.findByText('A few questions')).toBeTruthy();
    expect(screen.getByText('I couldn’t read everything — the blanks are yours.')).toBeTruthy();
  });

  // The same handover for a run that never produced a report at all. `outcome` is absent on a crash —
  // `withReport` is what sets it — so "not a success" is the honest test rather than "attention".
  it('carries on when the run failed outright', async () => {
    scan();
    await waitFor(() => expect(api.runWizardSkill).toHaveBeenCalled());

    await settle('failed');

    expect(await screen.findByText('A few questions')).toBeTruthy();
    expect(screen.getByText('I couldn’t read everything — the blanks are yours.')).toBeTruthy();
  });

  // IT USED TO WAIT ON A READ IT THREW AWAY. The answer was discarded, so the wait protected nothing:
  // the run posts its prefill BEFORE the frame that says it settled, and the questions read the file
  // for themselves on the way in and again at Continue. All it bought was a round trip between a run
  // ending and the person seeing anything.
  it('hands over as soon as its run settles, without waiting on a read of its own', async () => {
    scan();
    await waitFor(() => expect(api.runWizardSkill).toHaveBeenCalled());
    const read = deferred<{ state: WizardState | null }>();
    api.getWizard.mockReturnValue(read.promise);

    await settle('success', 'success');

    expect(await screen.findByText('A few questions')).toBeTruthy();
    await read.settle({
      state: { mode: 'brownfield', step: 'form', suggested: { answers: { what: 'a timeline' } } },
    });
  });

  // AN UPGRADED MID-SETUP PROJECT HAS NO SUCH SKILL: `seedSkills` only writes into an absent folder, so
  // a project scaffolded before these two existed will never grow them. The door answers 404 and the
  // only thing to do about it is ask the person, which is what the next screen does anyway.
  it('lands on the blank questions with a plain notice when the door refuses', async () => {
    api.runWizardSkill.mockRejectedValue(Object.assign(new Error('No such skill'), { status: 404 }));
    scan();

    expect(await screen.findByText('A few questions')).toBeTruthy();
    expect(
      screen.getByText('I couldn’t read your files this time — the questions below are all yours.'),
    ).toBeTruthy();
    expect((screen.getByLabelText(/what are you making/i) as HTMLTextAreaElement).value).toBe('');
  });

  it('can be skipped onto the blank questions, with nothing said about it', async () => {
    scan();
    await waitFor(() => expect(api.runWizardSkill).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Skip and answer them myself' }));

    expect(await screen.findByText('A few questions')).toBeTruthy();
    expect(screen.queryByText(/blanks are yours/)).toBeNull();
    expect((screen.getByLabelText(/what are you making/i) as HTMLTextAreaElement).value).toBe('');
  });

  // The step before it is what sends anyone here, and only in map mode: a new project has nothing to
  // read, so it goes straight to the questions.
  it('is where Continue on the machine check goes when a folder was brought in', async () => {
    api.getWizard.mockResolvedValue({ state: { mode: 'brownfield', step: 'backend' } });
    view({ mode: 'brownfield', start: 'backend', snapshot: opened });

    const go = await screen.findByRole('button', { name: 'Continue' });
    await waitFor(() => expect((go as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(go);

    await waitFor(() => expect(api.putWizard).toHaveBeenCalledWith({ mode: 'brownfield', step: 'scan' }));
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
        step: 'stack',
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
        step: 'stack',
        resumes: { 'foundation/TESTING.md': 'how it is checked' },
        answers: { what: '', who: '', done: '' },
      }),
    );
  });

  // A SCAN CAN LAND WHILE THE QUESTIONS ARE ON SCREEN. The step before hands over the moment its run
  // settles, and the run posts what it found into the same file — so a person may already be typing
  // when the suggestion arrives. `putWizard` REPLACES the file, so a Continue built from the read
  // taken on entry deletes it. The stack step's settle-read, taken at the press because this step
  // has no run of its own to watch.
  it('does not delete a suggestion that landed after it was opened', async () => {
    form();
    const go = await screen.findByRole('button', { name: 'Continue' });

    api.getWizard.mockResolvedValue({
      state: {
        mode: 'greenfield',
        step: 'form',
        suggested: { stack: 'TypeScript and Vite', packages: ['ripgrep'] },
      },
    });
    fireEvent.click(go);

    await waitFor(() =>
      expect(api.putWizard).toHaveBeenCalledWith({
        mode: 'greenfield',
        step: 'stack',
        suggested: { stack: 'TypeScript and Vite', packages: ['ripgrep'] },
        answers: { what: '', who: '', done: '' },
      }),
    );
  });

  // WHAT THE PERSON SAID WINS, ALWAYS, and this is the screen where a scan's words and a person's
  // words meet. A suggestion fills a field that has no answer in the file and says so where it does;
  // over an answer it is not shown at all, which is decision 77's "propose, never answer" made
  // visible rather than merely enforced at the route.
  const SUGGESTED = 'Suggested from your files — edit anything wrong.';

  it('fills only the blanks from what the run found, and marks the ones it filled', async () => {
    api.getWizard.mockResolvedValue({
      state: {
        mode: 'brownfield',
        step: 'form',
        answers: { what: 'mine, in my own words' },
        suggested: {
          answers: { what: 'a timeline of releases', who: 'the field team' },
          kind: 'game',
        },
      },
    });
    form();

    const box = (label: RegExp) => screen.getByLabelText(label) as HTMLTextAreaElement;
    await screen.findByRole('button', { name: 'Continue' });
    // The answered field keeps the person's sentence and is not marked.
    expect(box(/what are you making/i).value).toBe('mine, in my own words');
    // The empty one takes the suggestion and IS marked.
    expect(box(/who is it for/i).value).toBe('the field team');
    expect(box(/does "done" look like/i).value).toBe('');
    expect(screen.getAllByText(SUGGESTED)).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    // AND THE WRITE IS THE PROOF. A form that showed the answer and sent the suggestion would look
    // right on screen and overwrite the person's words on disk.
    await waitFor(() =>
      expect(api.putWizard).toHaveBeenCalledWith({
        mode: 'brownfield',
        step: 'stack',
        suggested: {
          answers: { what: 'a timeline of releases', who: 'the field team' },
          kind: 'game',
        },
        answers: { what: 'mine, in my own words', who: 'the field team', done: '' },
      }),
    );
    // The suggested kind is preselected, because nobody has pressed a tab.
    expect(api.patchConfig).toHaveBeenCalledWith(expect.objectContaining({ box: { kind: 'game' } }));
  });

  it('lets a suggestion be typed over, and stops calling it a suggestion', async () => {
    api.getWizard.mockResolvedValue({
      state: {
        mode: 'brownfield',
        step: 'form',
        suggested: { answers: { what: 'a timeline of releases' }, kind: 'game' },
      },
    });
    form();

    const what = (await screen.findByLabelText(/what are you making/i)) as HTMLTextAreaElement;
    expect(what.value).toBe('a timeline of releases');
    fireEvent.change(what, { target: { value: 'actually a meter reader' } });
    expect(screen.queryByText(SUGGESTED)).toBeNull();
    // And a tab pressed beats the suggested kind, which is the other half of overruling.
    fireEvent.click(screen.getByRole('button', { name: 'Web App' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() =>
      expect(api.putWizard).toHaveBeenCalledWith(
        expect.objectContaining({
          answers: { what: 'actually a meter reader', who: '', done: '' },
        }),
      ),
    );
    expect(api.patchConfig).toHaveBeenCalledWith(expect.objectContaining({ box: { kind: 'web' } }));
  });

  // A KIND THE PRODUCT DOES NOT HAVE is a real answer from a scan — `WizardSuggestions.kind` is a free
  // string for exactly that reason — and it must not preselect a tab that does not exist, nor blank
  // the one the project already has.
  it('ignores a suggested kind that is not one of the three', async () => {
    api.getWizard.mockResolvedValue({
      state: { mode: 'brownfield', step: 'form', suggested: { kind: 'embedded-firmware' } },
    });
    form();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));

    await waitFor(() =>
      expect(api.patchConfig).toHaveBeenCalledWith(expect.objectContaining({ box: { kind: 'web' } })),
    );
  });

  // AN ANSWER SAVED AS AN EMPTY STRING IS AN EMPTY FIELD, and it is the ordinary case rather than an
  // exotic one: Continue writes all three answers whatever was typed, so anybody who has passed this
  // screen once has three of them on disk. Read as "answered", a suggestion would be marked on the
  // field and then not shown in it — the hint and the box disagreeing about the same fact.
  it('treats an answer saved as empty as a blank the suggestion may fill', async () => {
    api.getWizard.mockResolvedValue({
      state: {
        mode: 'brownfield',
        step: 'form',
        answers: { what: '', who: '', done: '' },
        suggested: { answers: { what: 'a timeline of releases' } },
      },
    });
    form();

    const what = (await screen.findByLabelText(/what are you making/i)) as HTMLTextAreaElement;
    expect(what.value).toBe('a timeline of releases');
    expect(screen.getAllByText(SUGGESTED)).toHaveLength(1);
  });

  // THE ANSWERS COME BACK ON RE-ENTRY, with no suggestion anywhere near it. Pressing Back — or
  // resuming setup a day later — used to show three empty boxes over three saved answers, and
  // Continue then wrote the blanks over them.
  it('shows what was answered last time, unmarked', async () => {
    api.getWizard.mockResolvedValue({
      state: {
        mode: 'brownfield',
        step: 'form',
        answers: { what: 'a meter reader', who: 'the field team', done: 'one meter read' },
      },
    });
    form();

    expect(((await screen.findByLabelText(/what are you making/i)) as HTMLTextAreaElement).value).toBe(
      'a meter reader',
    );
    expect(screen.queryByText(SUGGESTED)).toBeNull();
  });

  it('keeps everything an engineer wants behind one fold', async () => {
    // W8. The words INSIDE the fold are where the jargon belongs, and the sweep below exempts it by
    // element for that reason — so this is what proves the fold is really there to be exempted.
    const { container } = form();
    await screen.findByRole('button', { name: 'Continue' });

    expect(container.querySelector('details')).not.toBeNull();
    expect(screen.getByText('For engineers')).toBeTruthy();
  });
});

// THE STACK, AFTER THE FORM AND NEVER INSIDE IT (W9). What the project is built with is a question the
// person mostly cannot answer and the model mostly can — so it is proposed rather than asked, on a
// screen built for overruling it. The agreement is what the docs step is briefed with and what the box
// is built to install, which is why it is settled HERE rather than left to the first run to discover.
describe('the stack step', () => {
  const answers = {
    what: 'a tool for reading meters',
    who: 'the field team',
    done: 'one meter read end to end',
  };

  // Re-stated per test for the scan describe's reason: `clearAllMocks` clears the CALLS and leaves the
  // implementation, so a rejection installed by one case would be the door's answer for the rest.
  beforeEach(() => {
    api.getWizard.mockResolvedValue({ state: { mode: 'greenfield', step: 'stack', answers } });
    api.runWizardSkill.mockResolvedValue({ run: { run: 'run-2', status: 'running' } });
  });

  const stack = () => view({ start: 'stack', snapshot: opened });

  // The file as it stands once the run has posted its proposal into it — what the step reads back when
  // the run settles, and what its own write then has to carry forward.
  const posted = (suggested: Record<string, unknown>) => ({
    state: { mode: 'greenfield', step: 'stack', answers, suggested },
  });

  const settle = async (outcome?: string, run = 'run-2'): Promise<void> => {
    await act(async () => {
      ws.push({ type: 'run:update', record: { run, status: 'success', ...(outcome ? { outcome } : {}) } });
    });
  };

  it('asks for a stack in the words the person used, and says what it is doing', async () => {
    stack();

    await waitFor(() => expect(api.runWizardSkill).toHaveBeenCalled());
    const [skill, prompt] = api.runWizardSkill.mock.calls[0] as [string, string];
    expect(skill).toBe('suggest-stack');
    // THE ANSWERS AS THE SERVER HAS THEM. The form wrote them one step ago and the file is the only
    // copy: a prompt built from what this screen happens to remember would be empty on a resume.
    expect(prompt).toContain('a tool for reading meters');
    expect(prompt).toContain('the field team');
    expect(prompt).toContain('one meter read end to end');
    // And the kind, which the form wrote to the config rather than to the wizard's own file.
    expect(prompt).toContain('The kind of project: web');
    expect(screen.getByText('Choosing a stack that fits…')).toBeTruthy();
  });

  // RE-ENTRY MUST NOT RE-ASK. Coming back — Back from the documents, or resuming setup tomorrow —
  // would spend a second run to propose what has already been agreed.
  it('does not ask twice: coming back to an agreed stack spends no run', async () => {
    api.getWizard.mockResolvedValue({
      state: { mode: 'greenfield', step: 'stack', answers, stack: 'Node, React and Vitest' },
    });
    stack();

    expect(await screen.findByText('Node, React and Vitest')).toBeTruthy();
    expect(api.runWizardSkill).not.toHaveBeenCalled();
  });

  it('shows what the run proposed once it has read the file back', async () => {
    stack();
    await waitFor(() => expect(api.runWizardSkill).toHaveBeenCalled());
    api.getWizard.mockResolvedValue(posted({ stack: 'Node, React and Vitest' }));

    await settle('success');

    expect(await screen.findByText('Node, React and Vitest')).toBeTruthy();
  });

  // THE PERSON'S WORD IS FINAL (W9). A proposal typed over is not a proposal any more, and what
  // reaches the file is what they wrote.
  it('takes the person’s own sentence over the proposal', async () => {
    stack();
    await waitFor(() => expect(api.runWizardSkill).toHaveBeenCalled());
    api.getWizard.mockResolvedValue(posted({ stack: 'Node, React and Vitest' }));
    await settle('success');

    expect(await screen.findByText('Node, React and Vitest')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/name your own/i), {
      target: { value: 'Python, and nothing else' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use this stack' }));

    await waitFor(() =>
      expect(api.putWizard).toHaveBeenCalledWith(
        expect.objectContaining({ step: 'docs', stack: 'Python, and nothing else' }),
      ),
    );
  });

  it('writes the agreed stack to the file and what the box installs to the config', async () => {
    stack();
    await waitFor(() => expect(api.runWizardSkill).toHaveBeenCalled());
    api.getWizard.mockResolvedValue(
      posted({ stack: 'Node, React and Vitest', packages: ['ffmpeg', 'imagemagick'] }),
    );
    await settle('success');

    fireEvent.click(await screen.findByRole('button', { name: 'Use this stack' }));

    // THE WHOLE FILE, INCLUDING WHAT THE RUN WROTE INTO IT WHILE THIS SCREEN WAS OPEN. `putWizard`
    // replaces the file, and the copy read on entry predates the proposal being agreed to here — so a
    // write built from the entry read would delete the suggestion it is agreeing with.
    await waitFor(() =>
      expect(api.putWizard).toHaveBeenCalledWith({
        mode: 'greenfield',
        step: 'docs',
        answers,
        suggested: { stack: 'Node, React and Vitest', packages: ['ffmpeg', 'imagemagick'] },
        stack: 'Node, React and Vitest',
      }),
    );
    // W9's payoff: what the sandbox has to install is known BEFORE the step that needs one, and it is
    // the config that decides how a box is built.
    expect(api.patchConfig).toHaveBeenCalledWith({
      box: { kind: 'web', packages: ['ffmpeg', 'imagemagick'] },
    });
  });

  // THE ONE SUGGESTION ON THIS SCREEN WITH A MACHINE EFFECT, and it was hidden. The packages the run
  // proposed are installed into every sandbox this project ever gets — the stack sentence, by
  // contrast, is read by a model and by nobody else — and the only place they appeared was inside a
  // fold that is closed until somebody opens it. `Use this stack` then installed a list they had
  // never been shown.
  it('says what will be installed in the body of the screen, not only inside the fold', async () => {
    api.getWizard.mockResolvedValue(posted({ stack: 'Node, React and Vitest', packages: ['jq', 'ripgrep'] }));
    stack();

    expect(await screen.findByRole('button', { name: 'Use this stack' })).toBeTruthy();
    const said = screen.getByTestId('verbatim-packages');
    expect(said.textContent).toBe('It will also install: jq, ripgrep');
    // OUTSIDE the fold, which is the whole point — a `<details>` renders none of its contents until
    // it is opened, so a sentence inside one is a sentence nobody reads.
    expect(said.closest('details')).toBeNull();
  });

  it('says nothing about installing when nothing extra was proposed', async () => {
    api.getWizard.mockResolvedValue(posted({ stack: 'Node, React and Vitest' }));
    stack();

    expect(await screen.findByRole('button', { name: 'Use this stack' })).toBeTruthy();
    expect(screen.queryByTestId('verbatim-packages')).toBeNull();
  });

  // A run that ended in anything but a clean success still hands over to the screen: the person can
  // name a stack themselves, and holding them on a report about a run they never asked for is worse.
  it('asks for one in the person’s own words when the run could not propose', async () => {
    stack();
    await waitFor(() => expect(api.runWizardSkill).toHaveBeenCalled());

    await settle('attention');

    expect(await screen.findByText('I couldn’t work one out — name your own below.')).toBeTruthy();
    // Nothing to agree WITH, so the button cannot be pressed until there is something to agree to.
    const go = screen.getByRole('button', { name: 'Use this stack' }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/name your own/i), { target: { value: 'Go and SQLite' } });
    expect(go.disabled).toBe(false);
    fireEvent.click(go);

    await waitFor(() =>
      expect(api.putWizard).toHaveBeenCalledWith(
        expect.objectContaining({ step: 'docs', stack: 'Go and SQLite' }),
      ),
    );
  });

  // THE DOOR REFUSING READS THE SAME WAY. A project part-way through setup when this arrived has no
  // such skill — `seedSkills` only writes into an absent folder — and there is nothing to do about it
  // but ask the person.
  it('lands on the same screen with a plain notice when the door refuses', async () => {
    api.runWizardSkill.mockRejectedValue(Object.assign(new Error('No such skill'), { status: 404 }));
    stack();

    expect(await screen.findByText('I couldn’t ask this time — name your own below.')).toBeTruthy();
  });

  it('can be skipped onto naming one yourself', async () => {
    stack();
    await waitFor(() => expect(api.runWizardSkill).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Skip and name it myself' }));

    expect(await screen.findByLabelText(/name your own/i)).toBeTruthy();
    expect(screen.queryByText(/name your own below/)).toBeNull();
  });

  // The step before it is what sends anyone here, and the file has to say so too: a Continue that
  // wrote one step and showed another is a setup you cannot resume into.
  it('is where Continue on the questions goes', async () => {
    api.getWizard.mockResolvedValue({ state: { mode: 'greenfield', step: 'form' } });
    view({ start: 'form', snapshot: opened });

    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));

    await waitFor(() =>
      expect(api.putWizard).toHaveBeenCalledWith(expect.objectContaining({ step: 'stack' })),
    );
    expect(await screen.findByText('Choosing a stack that fits…')).toBeTruthy();
  });
});

// THE THIRD AGENT MOMENT, AND IT IS THE COPILOT RATHER THAN A RUN (W3). Writing a README and five
// guiding documents out of three answers is a conversation, so the wizard drives the same copilot the
// dock does — and the brief is composed on the SERVER, at the credential seam, which is why the only
// thing sent from here is one plain sentence.
describe('the docs step', () => {
  beforeEach(() => {
    api.getWizard.mockResolvedValue({
      state: { mode: 'greenfield', step: 'docs', answers: { what: 'a tool for reading meters' } },
    });
    api.setAuthority.mockResolvedValue({ authorised: true });
    api.getReadiness.mockResolvedValue(readiness());
  });

  const docs = () => view({ start: 'docs', snapshot: opened });

  // THE ONLY WAY PAST THIS STEP, and the words matter: W3's ruling is that the loop runs until the
  // USER judges it ready, and no machine signal expresses that. Named once because a dozen cases
  // press it.
  const ADVANCE = 'It reads right — continue';

  // The copilot's own state frame, as the server broadcasts it: `onStart` raises it and the `finally`
  // of the turn lowers it, so this is the only thing that says a turn has ended.
  const turn = async (running: boolean): Promise<void> => {
    await act(async () => {
      ws.push({ type: 'copilot:state', state: { running } });
    });
  };

  const SUMMARIES: Record<string, string> = {
    'README.md': 'What the project is, in a paragraph.',
    'STACK.md': 'TypeScript, Vite and vitest.',
    'CODE-QUALITY.md': 'The commands your work has to pass.',
    'TESTING.md': 'What a test is for here.',
    'UX.md': 'Plain screens, and few choices at a time.',
    'DESIGN.md': 'One type scale and four corners.',
  };
  // Every plain name the map holds. Hand-written on purpose: this is the one place the WORDS are
  // the subject, and deriving them from the same map the screen reads would assert nothing.
  const PLAIN = ['The introduction', 'The stack', 'Quality gates', 'Testing', 'How it feels', 'How it looks'];

  // THE PATH COMES FROM THE LISTING, exactly as the gates step opens its documents — where a
  // foundation document lives is the server's fact and not a copy of the layout kept in the browser.
  const listing = [
    {
      key: 'foundation',
      label: 'Foundation',
      creatable: false,
      files: FOUNDATION_FILES.map((f) => ({
        name: f.name,
        path: foundationRel(f.name),
        category: 'foundation',
        managed: true,
        deletable: false,
        renameable: false,
      })),
    },
  ];

  const filed = (resumes: Record<string, string>) => {
    api.getWizard.mockResolvedValue({ state: { mode: 'greenfield', step: 'docs', resumes } });
    api.listControlFiles.mockResolvedValue(listing);
    return docs();
  };

  const cardFor = (plain: string): HTMLElement => {
    const card = screen.getAllByTestId('doc-card').find((c) => (c.textContent ?? '').startsWith(plain));
    if (!card) throw new Error(`no card reading "${plain}"`);
    return card;
  };

  // SAYING "THIS ONE". It was a click anywhere on the card and is the card's FACE now — a real control,
  // because the gesture had no tab stop, no focus ring and no Enter when it was a handler on the box.
  const face = (plain: string): HTMLElement => within(cardFor(plain)).getByRole('button', { name: plain });

  // A message typed into the embedded conversation and sent, which is the loop: the person reads a
  // summary, dislikes something, and says so. The composer is the dock's own organism wearing this
  // screen's label — `compact` drops the header and the panel takes its placeholder from the embedder,
  // because "Message the copilot" is a sentence the plain-words sweep refuses (W11, W7).
  const COMPOSER = 'Say what you’d change';
  const say = (text: string): void => {
    fireEvent.change(screen.getByPlaceholderText(COMPOSER), { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  };

  it('asks before it writes anything, and sends nothing until the answer is yes', async () => {
    docs();

    expect(await screen.findByText('Let the assistant write the drafts?')).toBeTruthy();
    expect(ws.sent).toHaveLength(0);
    expect(api.setAuthority).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Let it write' }));

    await waitFor(() => expect(ws.sent).toHaveLength(1));
    expect(ws.sent[0]).toMatchObject({
      type: 'copilot:send',
      // ONE SENTENCE, AND THE BRIEF IS NOT IN IT. `wizardFrame` composes the contract and the answers
      // on the server, at the seam the credential uses — a brief the browser sends is one the browser
      // can edit, and it would also land in the person's own transcript.
      text: "Please set up this project's documents from my answers.",
    });
  });

  // THE GRANT HAS TO LAND FIRST, and this is not a tidiness point: the credential is minted per turn
  // from the authority the server holds at the moment the turn arrives. A turn that overtook the grant
  // would run without one and could not write a single foundation document.
  it('has the authority before the turn, not merely at the same time', async () => {
    const grant = deferred<{ authorised: boolean }>();
    api.setAuthority.mockReturnValue(grant.promise);
    docs();

    fireEvent.click(await screen.findByRole('button', { name: 'Let it write' }));

    await waitFor(() => expect(api.setAuthority).toHaveBeenCalledWith(true));
    expect(ws.sent).toHaveLength(0);

    await grant.settle({ authorised: true });

    expect(ws.sent).toHaveLength(1);
  });

  it('sends nothing when the answer is no, and leaves the offer standing', async () => {
    docs();

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(ws.sent).toHaveLength(0);
    expect(api.setAuthority).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Write the drafts' })).toBeTruthy();
  });

  it('shows what it is working on, and each summary as it lands', async () => {
    docs();
    fireEvent.click(await screen.findByRole('button', { name: 'Let it write' }));
    await waitFor(() => expect(ws.sent).toHaveLength(1));

    api.getWizard.mockResolvedValue({
      state: {
        mode: 'greenfield',
        step: 'docs',
        resumes: { 'README.md': 'What the project is, in a paragraph.' },
      },
    });
    // THE TURN STARTING IS THE CUE TO LOOK, and a clock keeps looking while it runs.
    await turn(true);

    expect(await screen.findByText('What the project is, in a paragraph.')).toBeTruthy();
    // IN WORDS, NOT AS A FILENAME, which is what this assertion said until the cards landed: the card
    // face is the plain name and the filename waits on the view that opens the file (decision 78).
    expect(screen.getByText('The introduction')).toBeTruthy();

    // The tool name comes off the transcript rather than out of the file, so it needs no read.
    await act(async () => {
      ws.push({ type: 'copilot:event', event: { kind: 'tool_use', name: 'Write' } });
    });
    expect(await screen.findByText('Write')).toBeTruthy();
  });

  // A READ PER TRANSCRIPT ITEM IS A READ PER TOOL CALL. A turn that writes six documents makes dozens
  // of them, each one a request for a file that changes six times in as many minutes — and every
  // extra item in the transcript, a hidden one included, asked again.
  it('does not ask the file again for every tool call', async () => {
    docs();
    fireEvent.click(await screen.findByRole('button', { name: 'Let it write' }));
    await waitFor(() => expect(ws.sent).toHaveLength(1));
    await turn(true);
    await waitFor(() => expect(api.getWizard.mock.calls.length).toBeGreaterThan(1));
    const asked = api.getWizard.mock.calls.length;

    for (const name of ['Write', 'Edit', 'Bash', 'Read', 'Write', 'Edit']) {
      await act(async () => {
        ws.push({ type: 'copilot:event', event: { kind: 'tool_use', name } });
      });
    }

    expect(api.getWizard.mock.calls.length).toBe(asked);
    // And the screen is still following the turn, so this is a throttle rather than a switch-off.
    expect(await screen.findByText('Edit')).toBeTruthy();
  });

  // THE TRANSCRIPT IS THE CONVERSATION'S, NOT THIS SCREEN'S, and it is hydrated from disk on connect.
  // "Did the turn fail" was read by scanning the whole of it, so one error item from a conversation
  // days old made every turn after it report a failure — under a screen that was working, with the
  // offer to write the drafts put back over a turn already running.
  it('reads a failure out of this turn, not out of the conversation it is in', async () => {
    docs();
    await act(async () => {
      ws.push({
        type: 'copilot:history',
        chats: [],
        items: [{ kind: 'error', text: 'the sign-in had expired' }],
        stats: { costUsd: 0, turns: 0, lastDurationMs: 0, contextTokens: 0 },
      });
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Let it write' }));
    await waitFor(() => expect(ws.sent).toHaveLength(1));
    await turn(true);

    expect(screen.queryByText(/Something went wrong while it was writing/)).toBeNull();

    // AND THE FIXTURE IS THICK ENOUGH TO TELL THE TWO APART: an error in THIS turn still says so, so
    // the assertion above is about which items were scanned and not about the copy being gone.
    await act(async () => {
      ws.push({ type: 'copilot:event', event: { kind: 'error', text: 'it fell over' } });
    });

    expect(
      screen.getByText('Something went wrong while it was writing — you can ask it to try again.'),
    ).toBeTruthy();
  });

  // AND A FAILURE BELONGS TO THE TURN IT HAPPENED IN, which is the other end of the same rule. The
  // scan window was opened once, by the offer, and never moved — so the report from a turn that fell
  // over stayed on the screen under every turn after it, including the one the person asked for to
  // fix it. "Something went wrong while it was writing" over a rewrite that has just succeeded is a
  // screen accusing itself.
  it('takes the failure down when a later turn goes through', async () => {
    docs();
    fireEvent.click(await screen.findByRole('button', { name: 'Let it write' }));
    await waitFor(() => expect(ws.sent).toHaveLength(1));
    await turn(true);
    await act(async () => {
      ws.push({ type: 'copilot:event', event: { kind: 'error', text: 'it fell over' } });
    });
    await turn(false);

    // The premise: the report really is on the screen before the second turn, or the assertion below
    // is about a sentence that was never there.
    expect(screen.getByText(/Something went wrong while it was writing/)).toBeTruthy();

    await turn(true);
    await turn(false);

    expect(screen.queryByText(/Something went wrong while it was writing/)).toBeNull();
  });

  // A TURN THAT NEVER STARTED CANNOT HAVE ENDED. `running` is false before the first frame, so an
  // ending read off that alone would walk the person off this screen the moment they authorised.
  it('does not treat the state before the turn as the turn ending', async () => {
    docs();
    fireEvent.click(await screen.findByRole('button', { name: 'Let it write' }));
    await waitFor(() => expect(ws.sent).toHaveLength(1));

    await turn(false);

    // The review is what a settle reveals now rather than the next step, so this is the assertion
    // that says the settle was not believed: no layout, and nothing asked of the machine.
    expect(screen.queryByRole('button', { name: ADVANCE })).toBeNull();
    expect(screen.queryByText('Do you track work somewhere today?')).toBeNull();
    expect(api.getReadiness).not.toHaveBeenCalled();
  });

  // WRITING THE TWO EXECUTED DOCUMENTS AS AN AGENT TRIPS THE BLOCK BY DESIGN (decision 51). The wizard
  // surfaces the reading in its own voice rather than letting a refused Start do it later.
  // THE PRESS IS WHAT ASKS, since the loop landed: the settle opens the review and nothing else, so
  // both branches below are reached by the person saying the documents read right. decision 78.
  it('goes to the reading step when a gate document was rewritten', async () => {
    api.getReadiness.mockResolvedValue(readiness({ unreviewedGates: ['CODE-QUALITY.md'] }));
    docs();
    fireEvent.click(await screen.findByRole('button', { name: 'Let it write' }));
    await waitFor(() => expect(ws.sent).toHaveLength(1));

    await turn(true);
    await turn(false);
    fireEvent.click(await screen.findByRole('button', { name: ADVANCE }));

    expect(await screen.findByText('One thing to read before anything runs')).toBeTruthy();
  });

  it('goes straight to the import when none was', async () => {
    docs();
    fireEvent.click(await screen.findByRole('button', { name: 'Let it write' }));
    await waitFor(() => expect(ws.sent).toHaveLength(1));

    await turn(true);
    await turn(false);
    fireEvent.click(await screen.findByRole('button', { name: ADVANCE }));

    expect(await screen.findByText('Do you track work somewhere today?')).toBeTruthy();
  });

  // "DONE" HAS TO MEAN SOMETHING WAS WRITTEN. The step read the readiness and looked at one field of
  // it — the gate block — so a turn that wrote nothing at all, or that died four documents in, walked
  // the person to "That is setup done" over a project with no README and no foundation. The same
  // response already says which documents are there; it was simply not asked.
  describe('when the turn did not write everything', () => {
    const half = readiness({
      foundation: { present: ['STACK.md'], missing: ['CODE-QUALITY.md', 'UX.md'], ok: false },
    });

    const wrote = async (): Promise<void> => {
      docs();
      fireEvent.click(await screen.findByRole('button', { name: 'Let it write' }));
      await waitFor(() => expect(ws.sent).toHaveLength(1));
      await turn(true);
      await turn(false);
      // The machine is asked when the person says it reads right, and this is where a project with
      // four of the six documents is caught: the press is the only thing that asks.
      fireEvent.click(await screen.findByRole('button', { name: ADVANCE }));
    };

    it('says so plainly and stays, rather than reporting setup done', async () => {
      api.getReadiness.mockResolvedValue(half);

      await wrote();

      expect(
        await screen.findByText('It didn’t finish — 2 of the documents are still unwritten.'),
      ).toBeTruthy();
      // NAMED, AND IN WORDS. A filename is the one thing a beginner cannot act on, and these are the
      // same six names the review screen wears.
      expect(screen.getByText('Quality gates, How it feels')).toBeTruthy();
      expect(screen.queryByText('That is setup done')).toBeNull();
      expect(screen.queryByText('One thing to read before anything runs')).toBeNull();
      // AND THE FILE STAYS WHERE IT IS. Moving the step on over half-written documents is the same
      // lie written to disk, where the next open would believe it.
      expect(api.putWizard).not.toHaveBeenCalled();
    });

    // The README is not a foundation document and is read from its own field, so a turn that wrote
    // all five and never touched the README is a real state — and the one `foundation.missing` alone
    // cannot see.
    it('counts a missing README among them', async () => {
      api.getReadiness.mockResolvedValue(readiness({ readme: { ok: false, reason: 'no README' } }));

      await wrote();

      expect(
        await screen.findByText('It didn’t finish — one of the documents is still unwritten.'),
      ).toBeTruthy();
      // THE SENTENCE UNDER THE NOTICE, which is a paragraph — the same words are on a card and in the
      // selector above the chat by now, and this case is about what the report NAMES.
      expect(screen.getAllByText('The introduction').map((el) => el.tagName)).toContain('P');
    });

    it('offers the writing again, and takes it', async () => {
      api.getReadiness.mockResolvedValue(half);
      await wrote();
      expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Let it write' }));

      await waitFor(() => expect(ws.sent).toHaveLength(2));
      // The honest state goes with the offer being taken: a second turn is running, and a report
      // about the first one under it reads as a verdict on this one.
      expect(screen.queryByText(/still unwritten/)).toBeNull();
    });
  });

  // THE FILE HAS TO MOVE WITH THE SCREEN, and this step wrote nothing at all: the file sat at `docs`
  // after every exit but the last, so `wizardFrame` prefixed EVERY later conversation on the project
  // with a brief about writing foundation documents — and resuming re-offered the question that
  // rewrites all six over whatever had been edited since.
  //
  // FROM A FRESH READ, not the one taken on entry. The copilot files its summaries INTO this file
  // while the turn runs, and `putWizard` replaces it whole — so the entry read is stale by exactly
  // the thing this step produced. The stack step's settle-read, for the same reason.
  it('writes the step it moved to, carrying the summaries the turn filed', async () => {
    docs();
    fireEvent.click(await screen.findByRole('button', { name: 'Let it write' }));
    await waitFor(() => expect(ws.sent).toHaveLength(1));
    await turn(true);

    api.getWizard.mockResolvedValue({
      state: {
        mode: 'greenfield',
        step: 'docs',
        answers: { what: 'a tool for reading meters' },
        resumes: { 'README.md': 'What the project is, in a paragraph.' },
      },
    });
    await turn(false);
    fireEvent.click(await screen.findByRole('button', { name: ADVANCE }));

    await waitFor(() =>
      expect(api.putWizard).toHaveBeenCalledWith({
        mode: 'greenfield',
        step: 'import',
        answers: { what: 'a tool for reading meters' },
        resumes: { 'README.md': 'What the project is, in a paragraph.' },
      }),
    );
  });

  it('writes the reading step too, when a gate document was rewritten', async () => {
    api.getReadiness.mockResolvedValue(readiness({ unreviewedGates: ['CODE-QUALITY.md'] }));
    docs();
    fireEvent.click(await screen.findByRole('button', { name: 'Let it write' }));
    await waitFor(() => expect(ws.sent).toHaveLength(1));

    await turn(true);
    await turn(false);
    fireEvent.click(await screen.findByRole('button', { name: ADVANCE }));

    await waitFor(() =>
      expect(api.putWizard).toHaveBeenCalledWith(expect.objectContaining({ step: 'gates' })),
    );
  });

  // COMING BACK TO A STEP THAT HAS ALREADY RUN. The question is "let the assistant write the drafts?"
  // and the answer rewrites the README and all five documents — so raising it over a project that has
  // them is an offer to destroy work, phrased as an offer to start.
  describe('resuming with the summaries already filed', () => {
    const written = {
      mode: 'greenfield',
      step: 'docs',
      answers: { what: 'a tool for reading meters' },
      resumes: {
        'README.md': 'What the project is, in a paragraph.',
        'STACK.md': 'TypeScript, Vite and vitest.',
      },
    };

    // A RESUME LANDS IN THE REVIEW, never on the offer to write: the summaries are already there, so
    // there is nothing for a holding screen to hold. Plan C's `Carry on writing` / `Continue` pair is
    // what this replaces — more writing is asked for in the conversation now. decision 78.
    it('asks nothing, sends nothing, and opens on what was written', async () => {
      api.getWizard.mockResolvedValue({ state: written });
      docs();

      expect(await screen.findByRole('button', { name: ADVANCE })).toBeTruthy();
      expect(screen.queryByText('Let the assistant write the drafts?')).toBeNull();
      expect(ws.sent).toHaveLength(0);
      expect(api.setAuthority).not.toHaveBeenCalled();
      expect(screen.getByText('What the project is, in a paragraph.')).toBeTruthy();
      expect(screen.getByText('TypeScript, Vite and vitest.')).toBeTruthy();
    });

    // SUPERSEDES 'puts the question back when asked to carry on'. There is no second offer to raise:
    // the conversation is on the screen, and asking it for more writing is a message rather than a
    // button that re-raises the question about rewriting all six.
    it('asks for more writing in the conversation rather than behind a button', async () => {
      api.getWizard.mockResolvedValue({ state: written });
      docs();
      await screen.findByRole('button', { name: ADVANCE });

      expect(screen.queryByRole('button', { name: 'Carry on writing' })).toBeNull();
      say('the introduction says nothing about who it is for');

      expect(ws.sent.at(-1)).toMatchObject({
        type: 'copilot:send',
        text: 'the introduction says nothing about who it is for',
      });
      expect(screen.queryByText('Let the assistant write the drafts?')).toBeNull();
    });

    it('moves on without a turn when the person says it reads right, and writes the step', async () => {
      api.getWizard.mockResolvedValue({ state: written });
      docs();

      fireEvent.click(await screen.findByRole('button', { name: ADVANCE }));

      expect(await screen.findByText('Do you track work somewhere today?')).toBeTruthy();
      expect(ws.sent).toHaveLength(0);
      await waitFor(() => expect(api.putWizard).toHaveBeenCalledWith({ ...written, step: 'import' }));
    });
  });

  // THE SIX DOCUMENTS AS SOMETHING A PERSON CAN READ (W7, decision 78). A summary first, because a
  // beginner asked to review six documents they did not write will read none of them; the document
  // itself one press away, because the summary is the model's account of it and the file is the fact.
  describe('the résumé cards', () => {
    // SCOPED TO THE CARDS, and it has to be: the selector above the chat wears the same six plain
    // names, so a bare `findByText` here matches twice and says nothing about which one rendered.
    it('wears the plain name and the summary, one card per document', async () => {
      filed(SUMMARIES);
      await screen.findAllByTestId('doc-card');

      for (const plain of PLAIN) expect(cardFor(plain)).toBeTruthy();
      for (const summary of Object.values(SUMMARIES)) expect(screen.getByText(summary)).toBeTruthy();
      expect(screen.getAllByTestId('doc-card')).toHaveLength(6);
    });

    // THE TRIPWIRE FOR THIS SURFACE, and the same shape as the plain-words sweep: a filename is the
    // one thing a beginner cannot act on, and six of them down the side of the review screen is the
    // wizard talking to itself. Swept rather than named one by one, so a seventh card is covered by
    // this the day it is added.
    it('puts no filename on any card face', async () => {
      filed(SUMMARIES);
      // Waited for BY HANDLE and not by one of the plain names: a sweep whose premise is the very
      // thing it sweeps for cannot fail on the fault it names — put the filenames back on the faces
      // and this would have died at the `findByText` above, with the assertion below never reached.
      await screen.findAllByTestId('doc-card');

      for (const card of screen.getAllByTestId('doc-card')) {
        const face = card.textContent ?? '';
        expect(face.length, 'a card rendered almost nothing').toBeGreaterThan(10);
        expect(face, face).not.toContain('.md');
      }
    });

    // A MISSING SUMMARY MUST BE VISIBLE, NOT ABSENT. Rendering only what was written turns a
    // six-document project with three summaries into a three-document project, and the person
    // reviewing it has no way to know what they were not shown.
    it('keeps the set at six when only one document has been summarised', async () => {
      filed({ 'README.md': SUMMARIES['README.md'] });

      expect(await screen.findAllByTestId('doc-card')).toHaveLength(6);
      expect(cardFor('The introduction')).toBeTruthy();
      expect(screen.getAllByText('No summary yet — ask for one in the chat')).toHaveLength(5);
    });

    // The same absence while a turn is running is a different fact — it is being written right now —
    // and saying "ask for one in the chat" under a turn that is writing it reads as a fault.
    it('says a document is on its way while the turn is still running', async () => {
      filed({ 'README.md': SUMMARIES['README.md'] });
      await screen.findAllByTestId('doc-card');

      await turn(true);

      expect(screen.getAllByText('Being written…')).toHaveLength(5);
      expect(screen.queryByText('No summary yet — ask for one in the chat')).toBeNull();
    });

    it('opens the document itself, and the filename is on that view', async () => {
      api.getControlFile.mockResolvedValue({ content: 'gates:\n  - npm test\n' });
      filed(SUMMARIES);
      await screen.findAllByTestId('doc-card');

      fireEvent.click(within(cardFor('Quality gates')).getByRole('button', { name: 'Read it all' }));

      await waitFor(() => expect(api.getControlFile).toHaveBeenCalledWith(foundationRel('CODE-QUALITY.md')));
      const shown = (await screen.findByLabelText('CODE-QUALITY.md')) as HTMLTextAreaElement;
      expect(shown.value).toBe('gates:\n  - npm test\n');
      // The name of the file, on the one view that is about the file. The summary above it still says
      // "Quality gates", which is what the card is for.
      expect(within(cardFor('Quality gates')).getByText('CODE-QUALITY.md')).toBeTruthy();
    });

    // THE README IS NOT A CONTROL FILE. It lives at the project root, so the listing does not carry it
    // and Project Control's read cannot open it — the explorer's can, which is the door the file pane
    // already reads every project file through.
    it('reads the README through the explorer rather than the control door', async () => {
      api.readFsFile.mockResolvedValue({
        kind: 'text',
        path: 'README.md',
        name: 'README.md',
        size: 24,
        content: '# demo\n\nWhat it is.\n',
      });
      filed(SUMMARIES);
      await screen.findAllByTestId('doc-card');

      fireEvent.click(within(cardFor('The introduction')).getByRole('button', { name: 'Read it all' }));

      await waitFor(() => expect(api.readFsFile).toHaveBeenCalledWith('README.md'));
      const shown = (await screen.findByLabelText('README.md')) as HTMLTextAreaElement;
      expect(shown.value).toBe('# demo\n\nWhat it is.\n');
      expect(api.getControlFile).not.toHaveBeenCalled();
    });

    // Nothing to read on a card with nothing written: the offer would open an empty box, which reads
    // as the product failing rather than as a document that does not exist yet.
    // The opening screen is an OFFER to write, and six cards reading "no summary yet" underneath it
    // is a list of things that do not exist — the absence only becomes news once the writing has
    // begun.
    it('shows no cards at all before anything has been written', async () => {
      docs();

      await screen.findByText('Let the assistant write the drafts?');
      expect(screen.queryAllByTestId('doc-card')).toHaveLength(0);
    });

    // A NAME THIS PRODUCT DOES NOT KNOW GETS NO CARD, and the card it used to get was broken in both
    // directions: the listing has no path for it, so `Read it all` sits on `Opening…` for ever, and
    // saying "this one" about it blanks the selector above the chat, because that list is the six.
    // It can only arrive by hand-editing `wizard.yaml` — the server refuses a résumé filed under any
    // other name — so what is being refused here is a broken card, not a document.
    it('renders no card for a name outside the six', async () => {
      filed({ ...SUMMARIES, 'NOTES.md': 'Typed into the file by hand, under a name setup never writes.' });
      await screen.findAllByTestId('doc-card');

      expect(screen.getAllByTestId('doc-card')).toHaveLength(6);
      expect(screen.queryByText('Typed into the file by hand, under a name setup never writes.')).toBeNull();
      expect(screen.queryByText('NOTES.md')).toBeNull();
      // AND THE SELECTOR AGREES WITH THE CARDS, which is the half that makes this one fault rather
      // than two: both read `DOC_NAMES`, so neither can offer a subject the other cannot show.
      expect([...(screen.getByLabelText('Talking about') as HTMLSelectElement).options]).toHaveLength(7);
    });

    it('offers no reading of a document that has not been written', async () => {
      filed({ 'README.md': SUMMARIES['README.md'] });
      await screen.findAllByTestId('doc-card');

      expect(screen.getAllByRole('button', { name: 'Read it all' })).toHaveLength(1);
    });
  });

  // THE LOOP ITSELF (W3, decision 78): the summaries down one side, the conversation that wrote them
  // down the other, and the person deciding when it is done. Plan C advanced the moment the writing
  // turn settled, which was scaffolding — a machine cannot judge whether a document reads right.
  describe('the review layout', () => {
    it('opens when the writing settles, and moves nobody on', async () => {
      docs();
      fireEvent.click(await screen.findByRole('button', { name: 'Let it write' }));
      await waitFor(() => expect(ws.sent).toHaveLength(1));

      await turn(true);
      await turn(false);

      expect(await screen.findByRole('button', { name: ADVANCE })).toBeTruthy();
      expect(screen.getByLabelText('Talking about')).toBeTruthy();
      // SIX CARDS WITH NOTHING FILED, which is the one case the writing screen answers the other way:
      // there, six cards reading "no summary yet" sit under an OFFER to write them and are a list of
      // things that do not exist. Here the writing has been done, so a document with nothing to show
      // is the news — and a review with no cards on it reads as a screen that failed to load.
      expect(screen.getAllByTestId('doc-card')).toHaveLength(6);
      // The conversation is on the screen rather than in the dock behind it.
      expect(screen.getByPlaceholderText(COMPOSER)).toBeTruthy();
      // ONE CONVERSATION AND NOT TWO, said by the only thing that can tell them apart: the kick-off
      // this STEP sent is in the transcript the PANEL renders, which it can only be if the panel is
      // the same `useCopilot` instance the step drives. A second instance would be a second copy of
      // one server-side chat, and this line would be missing from it.
      expect(
        within(screen.getByTestId('verbatim-conversation')).getByText(
          "Please set up this project's documents from my answers.",
        ),
      ).toBeTruthy();
      // AND NOTHING MOVED. The settle used to write the file and change the step; both are the
      // person's now, so neither the machine nor the file was touched.
      expect(api.putWizard).not.toHaveBeenCalled();
      expect(api.getReadiness).not.toHaveBeenCalled();
      expect(screen.queryByText('That is setup done')).toBeNull();
      expect(screen.queryByText('One thing to read before anything runs')).toBeNull();
    });

    // THE PANEL WITHOUT THE DOCK AROUND IT (ruling W11). Each of these is a control the dock carries
    // and this screen must not: the assistant and the model were chosen two steps ago, the authority
    // was granted by the question that started the writing, the spend belongs to the dock's own
    // footer, and the ✕ would hide the conversation on a screen whose whole subject is it. Asserted
    // here as well as in test/copilot-compact.test.tsx, and the two are different claims: that one is
    // about the organism's option, this one is about the screen choosing it.
    it('embeds the conversation with none of the dock’s own controls', async () => {
      filed(SUMMARIES);
      await screen.findByRole('button', { name: ADVANCE });

      expect(screen.getByPlaceholderText(COMPOSER)).toBeTruthy();
      expect(screen.queryByText('Copilot')).toBeNull();
      expect(screen.queryByLabelText('Backend')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Authorise' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Compact' })).toBeNull();
      expect(screen.queryByTitle('Hide (session keeps running)')).toBeNull();
    });

    // ONE FILLED BUTTON AMONG THE WIZARD'S OWN, AND IT IS THE WAY ON. Two primaries on one screen is a
    // choice between them, and the choice this screen offers is not "continue or try again" — it is
    // "read this, then continue". SCOPED OUTSIDE `.copilot`: the composer's Send is the panel's own
    // action, it is disabled until something is typed, and it belongs to the other column.
    it('offers one filled button, and keeps it that way when the report arrives', async () => {
      api.getReadiness.mockResolvedValue(
        readiness({ foundation: { present: ['STACK.md'], missing: ['UX.md'], ok: false } }),
      );
      const { container } = filed(SUMMARIES);
      const filled = () =>
        [...container.querySelectorAll('.vb-btn-primary')].filter((b) => !b.closest('.copilot'));

      fireEvent.click(await screen.findByRole('button', { name: ADVANCE }));
      expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();

      expect(filled().map((b) => b.textContent)).toEqual([ADVANCE]);
    });

    // ONE CONVERSATION, NOT TWO. The panel on this screen and the dock's are the same `useCopilot`
    // instance keyed to the tab's socket, so a message typed here goes up the tab's own socket — a
    // second instance would be a second transcript of one server-side chat.
    it('sends what is typed beside the cards up the tab’s own socket', async () => {
      filed(SUMMARIES);
      await screen.findByRole('button', { name: ADVANCE });

      say('the testing one reads like a list of rules');

      expect(ws.sent).toHaveLength(1);
      expect(ws.sent[0]).toMatchObject({
        type: 'copilot:send',
        text: 'the testing one reads like a list of rules',
      });
      // The person's own words reach the transcript on this screen, which is what makes it a
      // conversation rather than a form that posts.
      expect(screen.getByText('the testing one reads like a list of rules')).toBeTruthy();
    });

    // CLICKING A CARD IS SAYING "THIS ONE". The name — never the content — rides the next message,
    // and the selector above the chat is the same state said out loud, so the person can see what
    // "it" is about to mean.
    it('carries the clicked document’s name on the next message, and says which above the chat', async () => {
      filed(SUMMARIES);
      await screen.findByRole('button', { name: ADVANCE });

      fireEvent.click(face('Quality gates'));

      expect((screen.getByLabelText('Talking about') as HTMLSelectElement).value).toBe('CODE-QUALITY.md');
      say('these commands are not the ones I run');
      expect(ws.sent.at(-1)).toMatchObject({
        type: 'copilot:send',
        text: 'these commands are not the ones I run',
        attach: 'CODE-QUALITY.md',
      });
    });

    // THE GESTURE IS A CONTROL, AND THIS IS THE HALF A CLICK TEST CANNOT SEE. It was `onClick` on the
    // card's box: a mouse could say "this one" and a keyboard could not — no tab stop, no focus ring,
    // nothing Enter would reach — and the offer to read the document sat INSIDE that click target.
    //
    // ASSERTED AS STRUCTURE RATHER THAN AS A KEYPRESS, because jsdom does not implement a button's
    // activation behaviour: measured here, a keydown of Enter on a focused `<button>` fires no click
    // at all, so a test that pressed it would prove the opposite of what it claimed. What makes Enter
    // and Space work is the element being a real button, which is what this pins; the browser harness
    // then walks the actual tab order and the focus ring on every one of them (check 8).
    it('puts the “this one” gesture on a real button, with nothing nested inside it', async () => {
      filed(SUMMARIES);
      await screen.findByRole('button', { name: ADVANCE });

      const gesture = face('Quality gates');
      expect(gesture.tagName).toBe('BUTTON');
      expect(gesture.getAttribute('type')).toBe('button');
      expect(gesture.hasAttribute('disabled')).toBe(false);
      // NOTHING INTERACTIVE INSIDE IT, and `Read it all` is its sibling rather than its child — a
      // control inside a control is a click whose meaning depends on where in it you landed.
      expect(gesture.querySelector('button, a, input, select, textarea')).toBeNull();
      expect(cardFor('Quality gates').hasAttribute('onclick')).toBe(false);

      gesture.focus();
      expect(document.activeElement).toBe(gesture);
    });

    // AND OPENING A DOCUMENT STILL SAYS IT TOO, which is what the whole-card click was really for:
    // somebody who has just pressed Read it all is looking at that document by any definition.
    it('takes “Read it all” as saying this one as well', async () => {
      filed(SUMMARIES);
      await screen.findByRole('button', { name: ADVANCE });

      fireEvent.click(within(cardFor('How it feels')).getByRole('button', { name: 'Read it all' }));

      expect((screen.getByLabelText('Talking about') as HTMLSelectElement).value).toBe('UX.md');
    });

    it('offers the six by name and rides whichever is chosen, until it is changed', async () => {
      filed(SUMMARIES);
      const select = (await screen.findByLabelText('Talking about')) as HTMLSelectElement;

      expect([...select.options].map((o) => o.textContent)).toEqual(['Nothing in particular', ...PLAIN]);

      fireEvent.change(select, { target: { value: 'UX.md' } });
      say('this one is too abstract');
      expect(ws.sent.at(-1)).toMatchObject({ attach: 'UX.md' });

      // UNTIL IT IS CHANGED, which is the half a single-message test cannot see: a second message
      // with nothing touched in between still means the same document.
      say('say it in one sentence instead');
      expect(ws.sent.at(-1)).toMatchObject({ attach: 'UX.md' });
    });

    // NOTHING IN PARTICULAR IS A REAL ANSWER — a question about the project rather than about one
    // document — and it has to be sayable, or the last card clicked follows the person around for
    // the rest of the conversation.
    it('carries no document at all once the selector is put back', async () => {
      filed(SUMMARIES);
      await screen.findByRole('button', { name: ADVANCE });
      fireEvent.click(face('Quality gates'));

      fireEvent.change(screen.getByLabelText('Talking about'), { target: { value: '' } });
      say('is any of this going to change once I start?');

      expect(ws.sent.at(-1)).not.toHaveProperty('attach');
    });

    // APPROVING A MOVING DOCUMENT. A turn in flight is rewriting the very thing the button says
    // reads right, so the button is shut while it runs and opens again when it stops.
    it('will not be pressed while a turn is rewriting the documents', async () => {
      filed(SUMMARIES);
      const advance = await screen.findByRole('button', { name: ADVANCE });
      expect(advance.hasAttribute('disabled')).toBe(false);

      await turn(true);
      expect(screen.getByRole('button', { name: ADVANCE }).hasAttribute('disabled')).toBe(true);
      // ONE INDICATOR, NOT TWO. The panel carries its own, with the same Cancel under it, so the
      // step's — which is the whole of the writing screen's evidence that anything is happening —
      // stands down once the conversation is on screen to show it.
      expect(screen.getAllByTestId('thinking')).toHaveLength(1);

      await turn(false);
      expect(screen.getByRole('button', { name: ADVANCE }).hasAttribute('disabled')).toBe(false);
    });

    // THREE CLICKS, ONE ADVANCE. The button is `disabled` while an action is in flight and nothing was
    // raising that flag: the press read the readiness and wrote the file with no `busy` in between, so
    // an impatient double-click on a slow network asked twice and wrote the step twice. Written as
    // three clicks in one tick because that is the shape of the fault — the second press lands before
    // the answer to the first.
    it('asks and writes once however many times it is pressed', async () => {
      const asked = deferred<Readiness>();
      api.getReadiness.mockReturnValue(asked.promise);
      filed(SUMMARIES);
      const advance = await screen.findByRole('button', { name: ADVANCE });

      fireEvent.click(advance);
      fireEvent.click(advance);
      fireEvent.click(advance);
      await asked.settle(readiness());

      expect(api.getReadiness).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(api.putWizard).toHaveBeenCalledTimes(1));
    });

    // THE PRESS ASKS THE MACHINE AGAIN, because the conversation has been writing documents since the
    // last answer — and two of the six carry commands the server later runs outside the sandbox, so
    // whether one of those was rewritten is a question only a fresh read can answer.
    it('asks the machine again on the press and branches on what it says', async () => {
      api.getReadiness.mockResolvedValue(readiness({ unreviewedGates: ['CODE-QUALITY.md'] }));
      filed(SUMMARIES);

      fireEvent.click(await screen.findByRole('button', { name: ADVANCE }));

      await waitFor(() => expect(api.getReadiness).toHaveBeenCalled());
      expect(await screen.findByText('One thing to read before anything runs')).toBeTruthy();
      await waitFor(() =>
        expect(api.putWizard).toHaveBeenCalledWith(expect.objectContaining({ step: 'gates' })),
      );
    });
  });
});

// DECISION 51 IN THE WIZARD'S OWN VOICE. CODE-QUALITY.md carries the `gates:` commands and TESTING.md
// the `smoke:` one, and the server runs both OUTSIDE the sandbox as the person — so an agent rewriting
// either blocks auto-pilot until somebody has read it. Cleared by a press and by nothing else, which is
// why the press has to be worth something: the documents are on this screen to be read.
describe('the gates step', () => {
  const foundation = [
    {
      key: 'foundation',
      label: 'Foundation',
      creatable: false,
      files: [
        {
          name: 'CODE-QUALITY.md',
          path: '.vibeboard/foundation/CODE-QUALITY.md',
          category: 'foundation',
          managed: true,
          deletable: false,
          renameable: false,
        },
        {
          name: 'TESTING.md',
          path: '.vibeboard/foundation/TESTING.md',
          category: 'foundation',
          managed: true,
          deletable: false,
          renameable: false,
        },
      ],
    },
  ];

  beforeEach(() => {
    api.getWizard.mockResolvedValue({ state: { mode: 'greenfield', step: 'gates' } });
    api.getReadiness.mockResolvedValue(readiness({ unreviewedGates: ['CODE-QUALITY.md', 'TESTING.md'] }));
    api.listControlFiles.mockResolvedValue(foundation);
    api.getControlFile.mockResolvedValue({ content: 'gates:\n  - npm test\n' });
    api.acknowledgeGates.mockResolvedValue({ ok: true });
  });

  const gates = () => view({ start: 'gates', snapshot: opened });

  it('names each document and opens the text of it', async () => {
    gates();

    expect(await screen.findByText('CODE-QUALITY.md')).toBeTruthy();
    expect(screen.getByText('TESTING.md')).toBeTruthy();
    // THE PATH COMES FROM THE LISTING, not from a copy of the layout kept in the browser. The names
    // the block carries are bare filenames, and where a foundation document lives is the server's
    // fact — the same listing Project Control opens every file from.
    await waitFor(() =>
      expect(api.getControlFile).toHaveBeenCalledWith('.vibeboard/foundation/CODE-QUALITY.md'),
    );
    expect(api.getControlFile).toHaveBeenCalledWith('.vibeboard/foundation/TESTING.md');
    const shown = (await screen.findAllByLabelText('CODE-QUALITY.md'))[0] as HTMLTextAreaElement;
    expect(shown.value).toBe('gates:\n  - npm test\n');
  });

  // THE PRESS IS A CLAIM ABOUT WHAT IS ON THE SCREEN — "I've read them" — and it is the only way the
  // block is ever cleared. It was live from the first paint: `unreviewedGates` reads `?? []` before
  // the answer lands, so for one round trip the screen named no documents, showed no documents, and
  // offered a button asserting both had been read. The next thing that button leads to is Start.
  it('will not take the word of somebody with nothing in front of them', async () => {
    const asked = deferred<Readiness>();
    api.getReadiness.mockReturnValue(asked.promise);
    gates();

    const carry = (await screen.findByRole('button', {
      name: "I've read them — carry on",
    })) as HTMLButtonElement;
    expect(carry.disabled).toBe(true);

    await asked.settle(readiness({ unreviewedGates: ['CODE-QUALITY.md', 'TESTING.md'] }));

    await waitFor(() => expect(carry.disabled).toBe(false));
  });

  // The other half of "in front of them": the readiness names a document and the LISTING is what
  // turns that name into a path to open it with. Without the path the fold holds "Opening…" for
  // ever, so the name is on the screen and the document is not.
  it('waits for the documents it named to be openable', async () => {
    api.listControlFiles.mockResolvedValue([
      { key: 'foundation', label: 'Foundation', creatable: false, files: [foundation[0].files[0]] },
    ]);
    gates();

    const carry = (await screen.findByRole('button', {
      name: "I've read them — carry on",
    })) as HTMLButtonElement;
    // CODE-QUALITY.md is in the listing and TESTING.md is not, so one of the two documents this
    // screen is naming cannot be opened at all.
    expect(await screen.findByText('TESTING.md')).toBeTruthy();
    await waitFor(() => expect(api.getControlFile).toHaveBeenCalled());
    expect(carry.disabled).toBe(true);
    expect(api.acknowledgeGates).not.toHaveBeenCalled();
  });

  it('clears the block and moves on once the server agrees it is clear', async () => {
    api.getReadiness
      .mockResolvedValueOnce(readiness({ unreviewedGates: ['CODE-QUALITY.md', 'TESTING.md'] }))
      .mockResolvedValue(readiness());
    gates();

    fireEvent.click(await screen.findByRole('button', { name: "I've read them — carry on" }));

    await waitFor(() => expect(api.acknowledgeGates).toHaveBeenCalled());
    expect(await screen.findByText('Do you track work somewhere today?')).toBeTruthy();
  });

  // AND THE FILE MOVES WITH IT. This step wrote nothing, so a setup finished through the reading step
  // left `docs` on disk — which is what `wizardFrame` keys on, and what a resume re-offers the
  // rewrite from. From a fresh read for the docs step's reason: the summaries the copilot filed are
  // in the file and not in this screen, and `putWizard` replaces it whole.
  it('writes the step it moved to, carrying what is in the file', async () => {
    const written = {
      mode: 'greenfield',
      step: 'gates',
      answers: { what: 'a tool for reading meters' },
      resumes: { 'CODE-QUALITY.md': 'The commands your work has to pass.' },
    };
    api.getWizard.mockResolvedValue({ state: written });
    api.getReadiness
      .mockResolvedValueOnce(readiness({ unreviewedGates: ['CODE-QUALITY.md', 'TESTING.md'] }))
      .mockResolvedValue(readiness());
    gates();

    fireEvent.click(await screen.findByRole('button', { name: "I've read them — carry on" }));

    await waitFor(() => expect(api.putWizard).toHaveBeenCalledWith({ ...written, step: 'import' }));
    expect(await screen.findByText('Do you track work somewhere today?')).toBeTruthy();
  });

  // ADVANCED BY THE ANSWER AND NOT BY THE PRESS. A screen that moved on before the server agreed would
  // put somebody past a block that is still there — and the next thing they press is Start.
  it('does not move on while the block is still there', async () => {
    gates();

    fireEvent.click(await screen.findByRole('button', { name: "I've read them — carry on" }));

    await waitFor(() => expect(api.getReadiness).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('That is setup done')).toBeNull();
    expect(screen.getByText('One thing to read before anything runs')).toBeTruthy();
  });
});

// THE LAST AGENT MOMENT (decision 79). Whatever the person already tracks work with walks in as cards
// — the copilot under the import frame, watched: the panel is on the screen while it happens, because
// a person reading the conversation IS the safety argument for the scope it runs under.
describe('the import step', () => {
  beforeEach(() => {
    api.getWizard.mockResolvedValue({ state: { mode: 'greenfield', step: 'import' } });
    api.setAuthority.mockResolvedValue({ authorised: true });
  });

  const importing = () => view({ start: 'import', snapshot: opened });

  const QUESTION = 'Do you track work somewhere today?';
  const BRING = 'Bring it in';
  const ADVANCE = 'Done — finish up';
  const GRANT = 'Let it make them';

  // The copilot's own state frame, as the server broadcasts it — the only thing that says a turn has
  // begun or ended. The docs step's helper exactly, and for its reason.
  const turn = async (running: boolean): Promise<void> => {
    await act(async () => {
      ws.push({ type: 'copilot:state', state: { running } });
    });
  };

  // What the model said, arriving the way an answer really does.
  const said = async (text: string): Promise<void> => {
    await act(async () => {
      ws.push({ type: 'copilot:event', event: { kind: 'text', text } });
    });
  };

  // The authority as the SERVER reports it: pushed on connect and on every change, which is the only
  // thing the browser knows about it. A new chat or a project switch revokes it, and this is how the
  // screen finds out.
  const granted = async (authorised: boolean): Promise<void> => {
    await act(async () => {
      ws.push({ type: 'copilot:authority', authorised });
    });
  };

  const fill = async (list: string, note?: string): Promise<void> => {
    fireEvent.click(await screen.findByRole('button', { name: 'Yes — bring it in' }));
    type(/paste your list/i, list);
    if (note !== undefined) type(/anything the assistant/i, note);
  };

  // SKIPPING IS FIRST-CLASS (W1): most people setting a project up do not keep a list anywhere, and
  // the no-door is their whole journey through this step. Nothing is spent and nothing is asked.
  it('takes the no-door to the end without spending a turn', async () => {
    importing();

    fireEvent.click(await screen.findByRole('button', { name: 'No — finish up' }));

    // THE FILE MOVES WITH THE SCREEN, from a fresh read: `wizardFrame` keys on the step, so a file
    // left at `import` would prefix every later conversation on the project with the import brief.
    await waitFor(() => expect(api.putWizard).toHaveBeenCalledWith({ mode: 'greenfield', step: 'ready' }));
    expect(ws.sent).toHaveLength(0);
    expect(api.setAuthority).not.toHaveBeenCalled();
    expect(screen.queryByText(QUESTION)).toBeNull();
  });

  // THE GRANT COMES FIRST, AND IT IS ASKED FOR RATHER THAN ASSUMED. The credential is minted per turn
  // from the authority the server holds when the turn arrives, so a turn that overtook the grant would
  // arrive without one and could not create a single card.
  it('asks before it makes anything when the authority has lapsed, and has it before the turn', async () => {
    const grant = deferred<{ authorised: boolean }>();
    api.setAuthority.mockReturnValue(grant.promise);
    importing();
    await fill('Ship the beta');

    fireEvent.click(screen.getByRole('button', { name: BRING }));

    expect(await screen.findByText('Let the assistant make the cards?')).toBeTruthy();
    expect(ws.sent).toHaveLength(0);
    expect(api.setAuthority).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: GRANT }));

    await waitFor(() => expect(api.setAuthority).toHaveBeenCalledWith(true));
    expect(ws.sent).toHaveLength(0);

    await grant.settle({ authorised: true });

    expect(ws.sent).toHaveLength(1);
  });

  // AND IT IS NOT ASKED WHEN IT IS ALREADY THERE — the other half, without which the case above only
  // proves the question is always raised. The documents step granted it a screen ago; asking a second
  // time for something the person can see they already gave teaches them the question means nothing.
  it('asks nothing when the authority is still live', async () => {
    importing();
    await granted(true);
    await fill('Ship the beta');

    fireEvent.click(screen.getByRole('button', { name: BRING }));

    await waitFor(() => expect(ws.sent).toHaveLength(1));
    expect(screen.queryByText('Let the assistant make the cards?')).toBeNull();
    expect(api.setAuthority).not.toHaveBeenCalled();
  });

  // ONE TURN, AND EVERY WORD IN IT IS THEIRS. The rules — the boards, the first column, no invented
  // bodies — are the FRAME's, composed on the server at the credential seam: a brief the browser sends
  // is one the browser can edit, and it would land in the person's own transcript on the way past.
  //
  // AND NO `attach`. That field names one of the six documents the review step talks about; an import
  // is about a list the product has no copy of, and a name on this turn would put a document's path in
  // front of a model that was asked about a todo list.
  it('sends the paste and the one-liner as one turn, attached to nothing', async () => {
    importing();
    await granted(true);
    await fill('Ship the beta\nFix the login bug', 'The top section is done, ignore it.');

    fireEvent.click(screen.getByRole('button', { name: BRING }));

    await waitFor(() => expect(ws.sent).toHaveLength(1));
    // Exact, not a substring: what the browser composes IS the person's words and a blank line, and a
    // sentence of the page's own invented between them would be invisible to a `toContain`.
    expect(ws.sent[0]).toEqual({
      type: 'copilot:send',
      text: 'Ship the beta\nFix the login bug\n\nThe top section is done, ignore it.',
      mode: 'bypassPermissions',
    });
    expect(ws.sent[0]).not.toHaveProperty('attach');
  });

  // THE WAY ON WAITS FOR THE CARDS. A turn that creates a dozen cards runs for minutes, and an advance
  // standing there while it works is an invitation to finish setup over a half-made board.
  it('opens the way on only once the turn has settled, and says what the assistant said', async () => {
    importing();
    await granted(true);
    await fill('Ship the beta');
    fireEvent.click(screen.getByRole('button', { name: BRING }));
    await waitFor(() => expect(ws.sent).toHaveLength(1));

    expect(screen.queryByRole('button', { name: ADVANCE })).toBeNull();
    await turn(true);
    expect(screen.queryByRole('button', { name: ADVANCE })).toBeNull();

    await said('I made 4 cards on features and 1 on engineering.');
    await turn(false);

    expect(await screen.findByRole('button', { name: ADVANCE })).toBeTruthy();
    // The count is the news, and it is the model's own sentence rather than a number this screen
    // counted — nothing in the browser knows how many cards were made.
    expect(screen.getByTestId('verbatim-made').textContent).toBe(
      'I made 4 cards on features and 1 on engineering.',
    );

    fireEvent.click(screen.getByRole('button', { name: ADVANCE }));

    await waitFor(() =>
      expect(api.putWizard).toHaveBeenCalledWith(expect.objectContaining({ step: 'ready' })),
    );
  });

  // THE TRANSCRIPT IS THE TAB'S, and the documents step's turns are still in it when this screen
  // mounts. Reading it from the start would stand under the question reporting what THAT turn was
  // last doing — a tool name and a closing sentence about six documents, presented as this import's.
  it('reports nothing of the conversation it inherited', async () => {
    importing();
    await act(async () => {
      ws.push({
        type: 'copilot:history',
        chats: [],
        items: [
          { kind: 'tool', text: '', toolName: 'Write' },
          { kind: 'assistant', text: 'All six documents are written.' },
        ],
        stats: { costUsd: 0, turns: 1, lastDurationMs: 0, contextTokens: 0 },
      });
    });
    await turn(false);

    expect(await screen.findByText(QUESTION)).toBeTruthy();
    expect(screen.queryByTestId('verbatim-tool')).toBeNull();
    expect(screen.queryByTestId('verbatim-made')).toBeNull();
  });

  // A FILE FROM THE BUILD BEFORE THIS ONE. `handoff` was where setup ended and is retired from the
  // flow; the step stays in the union so a setup parked there still reads, and this is where it lands.
  // decision 79.
  it('opens the import on a file left at the step that used to end setup', async () => {
    api.getWizard.mockResolvedValue({ state: { mode: 'greenfield', step: 'handoff' } });

    view({ start: 'handoff', snapshot: opened });

    expect(await screen.findByText(QUESTION)).toBeTruthy();
  });
});

// THE END OF SETUP, WHICH IS A REPORT AND NOT A CELEBRATION (W1, decision 79). It says what is now in
// place in plain sentences, says honestly whether auto-pilot could start, and does not hold anybody
// here over the answer: the wizard ends at "project ready to hand over", and a gap that is left is the
// board's to show.
//
// EVERY SENTENCE COMES FROM WHAT THE WIZARD ALREADY HOLDS — the file and the snapshot — plus one read
// of the readiness. Nothing here asks the server what it set up, because a summary that re-derives its
// own facts is a second opinion about them.
describe('the ready screen', () => {
  const FINISH = 'Open the board';
  const DOCUMENTS = 'Six documents written — read them any time in Project Control';
  const ALL_SIX = Object.fromEntries(
    ['README.md', 'STACK.md', 'CODE-QUALITY.md', 'TESTING.md', 'UX.md', 'DESIGN.md'].map((name) => [
      name,
      `What ${name} says, in a sentence.`,
    ]),
  );

  const finished = (state: Partial<WizardState> = {}) => {
    api.getWizard.mockResolvedValue({ state: { mode: 'greenfield', step: 'ready', ...state } });
    return view({ start: 'ready', snapshot: opened });
  };

  it('says what was set up, one plain sentence at a time', async () => {
    const stack = 'A small web app in TypeScript, with React for the screens and Vitest for the tests.';
    finished({ stack, resumes: ALL_SIX });

    expect(await screen.findByText(DOCUMENTS)).toBeTruthy();
    // The kind is the config's — the form wrote it there — and the plain name is the one the form
    // offered, not the slug the image is built from.
    expect(screen.getByText('Set up as: Web App')).toBeTruthy();
    // The sentence is the model's or the person's own, whole: it is what the box will be built
    // against, and a wizard that reworded it here would be re-deciding it on the way out.
    expect(screen.getByTestId('verbatim-stack').textContent).toBe(stack);
    expect(screen.getByRole('button', { name: FINISH })).toBeTruthy();
  });

  // ANYTHING UNKNOWN IS OMITTED RATHER THAN GUESSED, and a heading over nothing is the failure this
  // pins: a setup that skipped the stack and the documents has nothing to say about either, and
  // "Six documents written" over a project with none is the one sentence this screen must never say.
  it('omits what it cannot say, and still ends setup', async () => {
    finished();

    expect(await screen.findByRole('button', { name: FINISH })).toBeTruthy();
    expect(screen.queryByText(DOCUMENTS)).toBeNull();
    expect(screen.queryByTestId('verbatim-stack')).toBeNull();
    expect(screen.queryByTestId('verbatim-imported')).toBeNull();
  });

  // A PART-WRITTEN SET IS NOT SIX. The sentence counts, so it is said when the count is what it says
  // — the documents step can end with fewer, and a line that rounded five up to six would be the
  // screen lying about the one thing a person cannot check from here.
  it('does not call five documents six', async () => {
    const five = Object.fromEntries(Object.entries(ALL_SIX).filter(([name]) => name !== 'DESIGN.md'));
    finished({ resumes: five });

    expect(await screen.findByRole('button', { name: FINISH })).toBeTruthy();
    expect(screen.queryByText(DOCUMENTS)).toBeNull();
  });

  // READINESS, HONESTLY, AND IT NEVER STANDS IN THE WAY (W1). Setup ends at a project ready to hand
  // over; whether auto-pilot could start this second is the board's question, and holding somebody
  // inside the wizard over it would make the last screen a second gate on top of decision 74's.
  it('lists what is still missing without blocking the way out', async () => {
    api.getReadiness.mockResolvedValue(
      readiness({
        ok: false,
        blockers: ['foundation/UX.md has not been written yet.', 'There is no card on any board.'],
      }),
    );
    finished();

    expect(await screen.findByText('foundation/UX.md has not been written yet.')).toBeTruthy();
    expect(screen.getByText('There is no card on any board.')).toBeTruthy();
    expect(screen.getByText('You can fix these from the board — nothing is lost.')).toBeTruthy();
    expect(screen.queryByText('Everything auto-pilot needs is here.')).toBeNull();

    const finish = screen.getByRole('button', { name: FINISH }) as HTMLButtonElement;
    expect(finish.disabled).toBe(false);
    fireEvent.click(finish);
    await waitFor(() => expect(onExit).toHaveBeenCalledTimes(1));
  });

  it('says so when there is nothing missing', async () => {
    finished();

    expect(await screen.findByText('Everything auto-pilot needs is here.')).toBeTruthy();
    expect(screen.queryByText('You can fix these from the board — nothing is lost.')).toBeNull();
  });

  // A READ THAT FAILED IS NOT AN ANSWER. Reassurance over a question that could not be asked is the
  // lie `useReadiness` exists to prevent, and a blocker list invented from a rejection is the other
  // one — so a failed read says neither, and the board asks again.
  it('promises nothing when the readiness could not be read', async () => {
    api.getReadiness.mockRejectedValue(new Error('no'));
    finished({ stack: 'TypeScript and React.' });

    expect(await screen.findByTestId('verbatim-stack')).toBeTruthy();
    await waitFor(() => expect(api.getReadiness).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByText('Everything auto-pilot needs is here.')).toBeNull();
    expect(screen.queryByText('You can fix these from the board — nothing is lost.')).toBeNull();
    expect((screen.getByRole('button', { name: FINISH }) as HTMLButtonElement).disabled).toBe(false);
  });

  // WHAT THE IMPORT DID, CARRIED FORWARD BY THE SCREEN THAT SAW IT. The count is the model's own
  // closing sentence and lives in the step that ran the turn; the ready screen is mounted after that
  // step is gone, so it is handed over on the way — the scan step's notice exactly.
  it('repeats what the import reported, in the assistant’s own words', async () => {
    api.getWizard.mockResolvedValue({ state: { mode: 'greenfield', step: 'import' } });
    api.setAuthority.mockResolvedValue({ authorised: true });
    view({ start: 'import', snapshot: opened });
    await act(async () => {
      ws.push({ type: 'copilot:authority', authorised: true });
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Yes — bring it in' }));
    type(/paste your list/i, 'Ship the beta');
    fireEvent.click(screen.getByRole('button', { name: 'Bring it in' }));
    await waitFor(() => expect(ws.sent).toHaveLength(1));

    const made = 'I made 6 cards on features and 2 on engineering.';
    await act(async () => {
      ws.push({ type: 'copilot:state', state: { running: true } });
    });
    await act(async () => {
      ws.push({ type: 'copilot:event', event: { kind: 'text', text: made } });
    });
    await act(async () => {
      ws.push({ type: 'copilot:state', state: { running: false } });
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Done — finish up' }));

    expect(await screen.findByTestId('verbatim-imported')).toBeTruthy();
    expect(screen.getByTestId('verbatim-imported').textContent).toBe(made);
  });

  // AND THE OTHER HALF, without which the case above only proves a sentence can appear: the no-door
  // is the common journey (W1), and a screen reporting an import over a person who never ran one
  // would be the summary inventing the one fact on it that cost money.
  it('says nothing about an import that never ran', async () => {
    api.getWizard.mockResolvedValue({ state: { mode: 'greenfield', step: 'import' } });
    view({ start: 'import', snapshot: opened });

    fireEvent.click(await screen.findByRole('button', { name: 'No — finish up' }));

    expect(await screen.findByRole('button', { name: FINISH })).toBeTruthy();
    expect(screen.queryByTestId('verbatim-imported')).toBeNull();
  });
});

// W7, OVER EVERY STEP AND NOT THE ONE THAT HAPPENS TO HAVE A FOLD. The tripwire lived inside the form
// step's describe and swept four words on one screen; the three words that were actually on the wizard
// — "container", "Repository", "copilot" — were all on the other three steps, so it passed over each of
// them. It is a sweep of the SURFACE now.
//
// TWO EXEMPTIONS, BOTH BY ELEMENT AND NEITHER BY WORD:
//
//   - `<details>`, which is labelled "For engineers" and is the place those words belong.
//   - anything rendered VERBATIM because the words are not this screen's to choose. Two of those now:
//     the probe's own sentence, which is the only thing on the screen that names the command or the
//     setting that clears the fault — reworded here it would send somebody to fix what is not broken —
//     and the model's stack proposal, which the person is being shown precisely so they can overrule
//     it. Both carry a `verbatim-` test handle and this skips them by element; the fixtures below put
//     jargon INSIDE each, so removing a handle turns this red rather than green.
//
// AND `verbatim-conversation` IS NOW THE TRANSCRIPT AND NOT THE PANEL AROUND IT (W11). The review used
// to skip the whole embedded copilot, which put its composer, its selects and its readout inside an
// exemption written for the model's own words. The panel renders `compact` there — no header, no
// pickers, no readout — so what is left beside the transcript is the composer, and that is the wizard's
// to label.
//
// A PLACEHOLDER IS COPY AND `textContent` CANNOT SEE IT, which is how "Message the copilot" sat on the
// review screen through every run of this sweep. A composer has no label but its placeholder, so the
// attribute is read here as text: the identity step's three are paths and neither fold nor exemption
// hides them.
//
// The list is every word the product's own code uses constantly, which is exactly why they leak.
describe('the words on every step (W7)', () => {
  const JARGON = [
    'config',
    'yaml',
    'backend',
    'docker',
    'container',
    'repository',
    'copilot',
    'scaffold',
    'sandbox',
  ];

  const sweep = (what: string, container: HTMLElement): void => {
    const plain = container.cloneNode(true) as HTMLElement;
    for (const fold of plain.querySelectorAll('details')) fold.remove();
    for (const quoted of plain.querySelectorAll('[data-testid^="verbatim"]')) quoted.remove();
    const labels = [...plain.querySelectorAll('[placeholder]')].map((el) => el.getAttribute('placeholder'));
    const text = [plain.textContent ?? '', ...labels].join(' ').toLowerCase();
    // A step that rendered nothing would pass every assertion below it.
    expect(text.length, `${what} rendered almost nothing`).toBeGreaterThan(60);
    for (const word of JARGON) expect(text, `${what}: "${word}"`).not.toContain(word);
  };

  beforeEach(() => {
    api.getWizard.mockResolvedValue({ state: { mode: 'greenfield', step: 'backend' } });
    // The scan sweep below needs a door that answers and a run that does not settle, so the screen it
    // is reading is the waiting one. Re-stated here for the reason the scan describe re-states it.
    api.runWizardSkill.mockResolvedValue({ run: { run: 'run-1', status: 'running' } });
  });

  it('asks for a project in plain words, through either door', () => {
    sweep('starting a new project', view().container);
    cleanup();
    sweep('bringing a folder in', view({ mode: 'brownfield' }).container);
  });

  it('says the machine is ready in plain words', async () => {
    const { container } = view({ start: 'backend', snapshot: opened });
    await screen.findByText('Connected and ready.');

    sweep('the machine is ready', container);
  });

  it('says what is wrong in plain words, whatever the probe refused', async () => {
    // The probe's four refusal kinds, each with a reason FULL of the words this sweeps for — because
    // the reason is the server's and is exempt, and a fixture that did not carry them would leave the
    // exemption untested. The heading beside it is ours, and is what is being read here.
    const reasons: [NonNullable<SandboxState['refusalKind']>, string][] = [
      ['credential', 'the Claude Code sign-in on this machine has expired'],
      ['docker', 'the agent image vibeboard-agent:latest is not built yet — run a docker build'],
      ['backend', 'the OpenCode server this project is attached to is not answering'],
      ['attached', 'this project is attached to a sandbox VibeBoard did not start'],
    ];
    for (const [refusalKind, reason] of reasons) {
      api.getSandbox.mockResolvedValue({
        ok: false,
        backend: 'managed',
        reason,
        refusalKind,
        agentRefusal: `Agents are disabled: ${reason}.`,
      });
      const { container } = view({ start: 'backend', snapshot: opened });
      await screen.findByText(reason);

      sweep(`the ${refusalKind} refusal`, container);
      cleanup();
    }
  });

  it('says what it is doing while it reads, in plain words', async () => {
    // The waiting screen is where "repository" wants to be said, which is why it is swept here: the
    // person it is talking to brought in a FOLDER, and that is the word they used for it themselves.
    api.getWizard.mockResolvedValue({ state: { mode: 'brownfield', step: 'scan' } });
    const { container } = view({ mode: 'brownfield', start: 'scan', snapshot: opened });
    await screen.findByText('Reading your files…');

    sweep('reading the folder', container);
  });

  it('chooses a stack, and reads out the model’s own words, in plain words', async () => {
    // The waiting screen first, where "repository" wants to be said again.
    api.getWizard.mockResolvedValue({ state: { mode: 'greenfield', step: 'stack', answers: {} } });
    const waiting = view({ start: 'stack', snapshot: opened });
    await screen.findByText('Choosing a stack that fits…');
    sweep('choosing a stack', waiting.container);
    cleanup();

    // Then the proposal, whose sentence is the MODEL'S and is rendered whole — full of the words this
    // sweeps for, because the fixture is what proves the exemption is the element and not the word.
    api.getWizard.mockResolvedValue({
      state: {
        mode: 'greenfield',
        step: 'stack',
        answers: {},
        stack: 'A Node repository, its config in yaml, run in a Docker container',
        // The package names are the model's too, and they are said in the BODY of the screen now
        // rather than only inside the fold — so `verbatim-packages` is a third exemption, and the
        // fixture is what proves it is the element and not the word.
        suggested: { packages: ['docker-cli', 'yamllint'] },
      },
    });
    const proposal = view({ start: 'stack', snapshot: opened });
    await screen.findByRole('button', { name: 'Use this stack' });
    expect(screen.getByTestId('verbatim-packages').textContent).toContain('docker-cli');
    sweep('the stack proposal', proposal.container);
  });

  it('asks to write the documents, and reads out the gate commands, in plain words', async () => {
    // The docs step opens on the question, so the sweep reads the dialog as well as the screen under
    // it — the question is the first thing anybody sees here.
    api.getWizard.mockResolvedValue({ state: { mode: 'greenfield', step: 'docs' } });
    const writing = view({ start: 'docs', snapshot: opened });
    await screen.findByText('Let the assistant write the drafts?');
    sweep('writing the documents', writing.container);
    cleanup();

    // And the gate step, whose documents are full of the words this sweeps for — inside the fold,
    // where they belong, so what is read here is the sentence asking somebody to open one.
    api.getWizard.mockResolvedValue({ state: { mode: 'greenfield', step: 'gates' } });
    api.getReadiness.mockResolvedValue(readiness({ unreviewedGates: ['CODE-QUALITY.md'] }));
    api.listControlFiles.mockResolvedValue([
      {
        key: 'foundation',
        label: 'Foundation',
        creatable: false,
        files: [
          {
            name: 'CODE-QUALITY.md',
            path: '.vibeboard/foundation/CODE-QUALITY.md',
            category: 'foundation',
            managed: true,
            deletable: false,
            renameable: false,
          },
        ],
      },
    ]);
    api.getControlFile.mockResolvedValue({ content: 'gates:\n  - docker compose config\n' });
    const reading = view({ start: 'gates', snapshot: opened });
    await screen.findByRole('button', { name: "I've read them — carry on" });

    sweep('the gate commands', reading.container);
  });

  it('asks its questions and hands over in plain words', async () => {
    api.getWizard.mockResolvedValue({ state: { mode: 'greenfield', step: 'form' } });
    const form = view({ start: 'form', snapshot: opened });
    await screen.findByRole('button', { name: 'Continue' });
    sweep('the questions', form.container);
    cleanup();

    sweep('the hand-off', view({ start: 'ready', snapshot: opened }).container);
  });

  // THE QUESTIONS WITH THE SCAN'S NEWS ON THEM, which is a different screen from the one above and
  // the one a person brought a folder in actually sees. The notice is written on the step BEFORE and
  // read on this one, so neither step's own sweep covers it — and it is the sentence most likely to
  // reach for "repository", because it is about the files that were just read.
  it('says what the reading run could not do, in plain words', async () => {
    api.getWizard.mockResolvedValue({ state: { mode: 'brownfield', step: 'scan' } });
    const { container } = view({ mode: 'brownfield', start: 'scan', snapshot: opened });
    await waitFor(() => expect(api.runWizardSkill).toHaveBeenCalled());

    await act(async () => {
      ws.push({ type: 'run:update', record: { run: 'run-1', status: 'attention', outcome: 'attention' } });
    });

    // The premise: the notice really is on the screen being swept, not merely somewhere in the app.
    expect(await screen.findByText('I couldn’t read everything — the blanks are yours.')).toBeTruthy();
    sweep('the questions after a half-read folder', container);
  });

  // THE DOCUMENTS BEING WRITTEN, which is where the model's own words are thickest: the tool it
  // reached for and the summaries it filed are both on screen, both exempt by element, and neither
  // was covered — the case above this one reads the question and stops there.
  it('shows the writing in plain words, around the words that are not its own', async () => {
    api.getWizard.mockResolvedValue({ state: { mode: 'greenfield', step: 'docs' } });
    const { container } = view({ start: 'docs', snapshot: opened });
    fireEvent.click(await screen.findByRole('button', { name: 'Let it write' }));
    await waitFor(() => expect(ws.sent).toHaveLength(1));

    api.getWizard.mockResolvedValue({
      state: {
        mode: 'greenfield',
        step: 'docs',
        // A summary FULL of the words this sweeps for, because it is the model's prose and the
        // exemption is the element. A fixture without them would leave the handle untested.
        resumes: { 'STACK.md': 'A Node repository, its config in yaml, run in a Docker container.' },
      },
    });
    await act(async () => {
      ws.push({ type: 'copilot:state', state: { running: true } });
    });
    await act(async () => {
      ws.push({ type: 'copilot:event', event: { kind: 'tool_use', name: 'DockerBuild' } });
    });

    expect(await screen.findByTestId('verbatim-tool')).toBeTruthy();
    expect(await screen.findByTestId('verbatim-resume')).toBeTruthy();
    sweep('the documents being written', container);
  });

  // THE REVIEW LAYOUT, which is the screen this step really is: the summaries down one side and the
  // conversation down the other. Everything the WIZARD says here is new copy — the selector above the
  // chat, the composer's own label, the button that ends the loop, the sentence under it — and all of
  // it is swept. What is exempt is the TRANSCRIPT, because those words are the model's, and the
  // fixture below is what proves the exemption is load-bearing rather than decorative: the reply is
  // full of the words this sweeps for, so taking the handle off `verbatim-conversation` turns this red
  // on every one of them.
  it('reads the documents beside the conversation in plain words', async () => {
    api.getWizard.mockResolvedValue({
      state: {
        mode: 'greenfield',
        step: 'docs',
        resumes: { 'README.md': 'What the project is, in a paragraph.' },
      },
    });
    const { container } = view({ start: 'docs', snapshot: opened });
    await screen.findByRole('button', { name: 'It reads right — continue' });

    // THE MODEL'S OWN REPLY, hydrated the way the conversation really arrives: from disk, on connect.
    // Without it the exemption wraps an empty list and this case proves nothing at all — which is what
    // it did, silently, the day the handle moved off the panel.
    await act(async () => {
      ws.push({
        type: 'copilot:history',
        chats: [],
        items: [
          { kind: 'user', text: "Please set up this project's documents from my answers." },
          {
            kind: 'assistant',
            text: 'All six are written. The stack document names the Docker container the repository builds, and the config is yaml.',
          },
        ],
        stats: { costUsd: 0, turns: 1, lastDurationMs: 0, contextTokens: 0 },
      });
    });

    const quoted = (screen.getByTestId('verbatim-conversation').textContent ?? '').toLowerCase();
    for (const word of ['docker', 'container', 'repository', 'config', 'yaml']) {
      expect(quoted, `the exempt transcript must carry "${word}" or it proves nothing`).toContain(word);
    }
    sweep('the review layout', container);
  });

  // THE IMPORT, WHICH IS THREE SCREENS IN ONE and every word on all three is the wizard's: the
  // question, the two fields under the yes-door, and what is left standing once the turn has run.
  // What is exempt there is the model's — the transcript and the closing sentence pulled out of it —
  // and the reply below is full of the words this sweeps for, so taking either handle off turns this
  // red rather than green.
  it('brings a list in, and reads out the assistant’s own words, in plain words', async () => {
    api.getWizard.mockResolvedValue({ state: { mode: 'greenfield', step: 'import' } });
    api.setAuthority.mockResolvedValue({ authorised: true });
    const { container } = view({ start: 'import', snapshot: opened });
    await act(async () => {
      ws.push({ type: 'copilot:authority', authorised: true });
    });

    await screen.findByRole('button', { name: 'Yes — bring it in' });
    sweep('the two doors', container);

    fireEvent.click(screen.getByRole('button', { name: 'Yes — bring it in' }));
    expect(screen.getByLabelText(/paste your list/i)).toBeTruthy();
    sweep('the list and the one-liner', container);

    fireEvent.change(screen.getByLabelText(/paste your list/i), { target: { value: 'Ship the beta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bring it in' }));
    await waitFor(() => expect(ws.sent).toHaveLength(1));

    const reply =
      'I made 4 cards. The docker container and the yaml config in your repository went to engineering, and the backend one too.';
    await act(async () => {
      ws.push({ type: 'copilot:state', state: { running: true } });
    });
    await act(async () => {
      ws.push({ type: 'copilot:event', event: { kind: 'text', text: reply } });
    });
    await act(async () => {
      ws.push({ type: 'copilot:state', state: { running: false } });
    });

    // The premise, both halves: the exempt elements really do carry the words, or their handles
    // prove nothing at all.
    expect(screen.getByTestId('verbatim-made').textContent).toBe(reply);
    expect((screen.getByTestId('verbatim-conversation').textContent ?? '').toLowerCase()).toContain('docker');
    sweep('the import once it has run', container);
  });

  // THE LAST SCREEN, WHERE THREE VOICES MEET AND ONLY ONE OF THEM IS THIS WIZARD'S. What it says about
  // the kind, the documents and the way out is its own copy and is swept. The agreed stack and the
  // import's count are the MODEL'S — shown because they were agreed and reported, not written here —
  // and the blockers are the SERVER'S, which name the file or the block that clears them and would
  // send somebody to fix the wrong thing if this screen reworded them. All three exempt elements carry
  // a fixture full of the words this sweeps for, so taking any one handle off turns this red.
  it('ends setup in plain words, around three sets of words that are not its own', async () => {
    api.getWizard.mockResolvedValue({ state: { mode: 'greenfield', step: 'import' } });
    api.setAuthority.mockResolvedValue({ authorised: true });
    api.getReadiness.mockResolvedValue(
      readiness({
        ok: false,
        // Verbatim from `coverageProblems` in src/core/autopilot-cover.ts, which is where this
        // sentence is composed: a blocker invented here would be plain in exactly the way the real
        // ones are not.
        blockers: ['This project has no autopilot block in config.yaml, so there is no lifecycle to run.'],
      }),
    );
    const { container } = view({ start: 'import', snapshot: opened });
    await act(async () => {
      ws.push({ type: 'copilot:authority', authorised: true });
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Yes — bring it in' }));
    fireEvent.change(screen.getByLabelText(/paste your list/i), { target: { value: 'Ship the beta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bring it in' }));
    await waitFor(() => expect(ws.sent).toHaveLength(1));

    const made = 'I made 4 cards. The docker container and the yaml config went to engineering.';
    await act(async () => {
      ws.push({ type: 'copilot:state', state: { running: true } });
    });
    await act(async () => {
      ws.push({ type: 'copilot:event', event: { kind: 'text', text: made } });
    });
    await act(async () => {
      ws.push({ type: 'copilot:state', state: { running: false } });
    });

    // The file as the closing screen reads it, with the stack the person agreed to in the model's
    // own sentence — the step writes and re-reads, so the answer has to be in place before the press.
    api.getWizard.mockResolvedValue({
      state: {
        mode: 'greenfield',
        step: 'ready',
        stack: 'A Node repository, its config in yaml, run in a Docker container',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Done — finish up' }));
    await screen.findByRole('button', { name: 'Open the board' });

    // The premises, all three: the exempt elements really do carry the words, or their handles prove
    // nothing at all.
    expect(await screen.findByTestId('verbatim-stack')).toBeTruthy();
    expect((screen.getByTestId('verbatim-stack').textContent ?? '').toLowerCase()).toContain('docker');
    expect(screen.getByTestId('verbatim-imported').textContent).toBe(made);
    expect((screen.getByTestId('verbatim-blockers').textContent ?? '').toLowerCase()).toContain('yaml');
    sweep('the end of setup', container);
  });

  // THE DOCUMENT ITSELF, OPENED, which is where the model's words are thicker than any summary: a
  // CODE-QUALITY.md is a list of commands, and half of them name the things this list sweeps for. A
  // fourth exemption by element, and the content below is the fixture that proves it — take
  // `verbatim-document` off the block and this case goes red on the word "docker".
  it('opens a document in the model’s own words, with plain words around it', async () => {
    api.getWizard.mockResolvedValue({
      state: {
        mode: 'greenfield',
        step: 'docs',
        resumes: { 'CODE-QUALITY.md': 'The commands your work has to pass.' },
      },
    });
    api.listControlFiles.mockResolvedValue([
      {
        key: 'foundation',
        label: 'Foundation',
        creatable: false,
        files: [
          {
            name: 'CODE-QUALITY.md',
            path: foundationRel('CODE-QUALITY.md'),
            category: 'foundation',
            managed: true,
            deletable: false,
            renameable: false,
          },
        ],
      },
    ]);
    api.getControlFile.mockResolvedValue({
      content: 'gates:\n  - docker compose config\n  - yamllint .\n\nRun them in the sandbox.\n',
    });
    const { container } = view({ start: 'docs', snapshot: opened });

    fireEvent.click(await screen.findByRole('button', { name: 'Read it all' }));
    await screen.findByLabelText('CODE-QUALITY.md');

    sweep('the document opened in full', container);
  });
});
