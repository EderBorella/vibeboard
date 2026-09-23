// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  restartOpencodeServer: vi.fn().mockResolvedValue({ ok: true, url: 'http://127.0.0.1:1' }),
  takeOverOpencodeServer: vi.fn().mockResolvedValue({ ok: true, url: 'http://127.0.0.1:2' }),
  rebuildBoxes: vi.fn().mockResolvedValue({ ok: true, removed: 2 }),
  buildAgentImage: vi.fn().mockResolvedValue({ ok: true, already: false }),
}));
vi.mock('../web/src/lib/api.js', () => api);

const { SandboxPanel } = await import('../web/src/organisms/settings/SandboxPanel.js');

import type { SandboxState } from '../web/src/lib/api.js';

afterEach(() => {
  cleanup();
  api.restartOpencodeServer.mockClear();
  api.takeOverOpencodeServer.mockClear();
  api.rebuildBoxes.mockClear();
  api.buildAgentImage.mockClear();
});

const state = (over: Partial<SandboxState> = {}): SandboxState => ({
  ok: true,
  profile: 'vibeboard-agent',
  backend: 'managed',
  agentRefusal: null,
  // `null` exactly when `agentRefusal` is null, which is the contract the field carries.
  refusalKind: null,
  ...over,
});

const show = (over: Partial<SandboxState> = {}, backend = 'opencode') =>
  render(<SandboxPanel state={state(over)} bump={0} backend={backend} onChanged={() => {}} />);

// BUILDING THE AGENT IMAGE, offered exactly where the refusal appears. The product used to detect this
// prerequisite, name it, and print a developer command at somebody with no repository to run it in.
describe('the build button', () => {
  const build = () => screen.queryByRole('button', { name: /Build the agent image/i });

  it('appears when the image is what is missing', () => {
    show({
      ok: false,
      reason: 'the agent image vibeboard-agent:latest is not built yet',
      refusalKind: 'docker',
      agentRefusal: 'no image',
      buildable: true,
    });
    expect(build()).toBeTruthy();
  });

  // THE HALF THAT MAKES THE FIRST ONE MEAN ANYTHING. `refusalKind` is `docker` for BOTH a missing daemon
  // and a missing image, so a panel keyed on that alone would offer to build against a daemon that is
  // not running — a button that cannot work, offered as the remedy for a fault it does not address.
  it('does NOT appear when docker itself is not running', () => {
    show({
      ok: false,
      reason: 'Docker is not available — no daemon',
      refusalKind: 'docker',
      agentRefusal: 'no docker',
    });
    expect(build()).toBeNull();
  });

  it('does not appear when the sandbox is fine', () => {
    show();
    expect(build()).toBeNull();
  });

  it('calls the build and refreshes the panel', async () => {
    const onChanged = vi.fn();
    render(
      <SandboxPanel
        state={state({
          ok: false,
          reason: 'not built yet',
          refusalKind: 'docker',
          agentRefusal: 'no image',
          buildable: true,
        })}
        bump={0}
        backend="opencode"
        onChanged={onChanged}
      />,
    );
    fireEvent.click(build() as HTMLElement);
    await waitFor(() => expect(api.buildAgentImage).toHaveBeenCalledTimes(1));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});

// THE BUTTON THE OWNER COULD NOT FIND. The image held Claude Code 2.1.221 and the host 2.1.280, and the
// image EXISTED, so nothing offered to rebuild it — and the one control on screen that said "rebuild" only
// threw containers away, which put them straight back on the same old image.
describe('an image behind this machine', () => {
  const STALE = 'vibeboard-agent:base has Claude Code 2.1.221 where this machine has 2.1.280';
  const rebuildImage = () => screen.getByRole('button', { name: 'Rebuild the agent image' });

  it('is offered the rebuild, and told by how much it is behind', () => {
    show({ imageStale: STALE });
    expect(rebuildImage()).toBeTruthy();
    expect(screen.getByText(/has Claude Code 2\.1\.221 where this machine has 2\.1\.280/)).toBeTruthy();
    // Still a working sandbox: agents run, so nothing may say they are disabled.
    expect(screen.queryByText(/Agents are disabled/i)).toBeNull();
  });

  // A REBUILT IMAGE DOES NOT REACH A RUNNING BOX. Boxes are adopted rather than remade, so the ones up
  // now go on running the old CLIs until they are thrown away — and a panel that went quiet after the
  // build would read as "fixed".
  it('says, once it has built, that the boxes already running keep the old image', async () => {
    show({ imageStale: STALE });
    fireEvent.click(rebuildImage());
    expect(await screen.findByText(/keep the image they were started from/i)).toBeTruthy();
  });

  it('says nothing about boxes when there turned out to be nothing to build', async () => {
    api.buildAgentImage.mockResolvedValueOnce({ ok: true, already: true });
    show({ imageStale: STALE });
    fireEvent.click(rebuildImage());
    await screen.findByRole('button', { name: 'Rebuild the agent image' });
    expect(screen.queryByText(/keep the image they were started from/i)).toBeNull();
  });

  it('drops that note once the boxes have been thrown away', async () => {
    show({ imageStale: STALE });
    fireEvent.click(rebuildImage());
    await screen.findByText(/keep the image they were started from/i);
    fireEvent.click(screen.getByRole('button', { name: /rebuild the agent boxes/i }));
    fireEvent.click(await screen.findByRole('button', { name: /throw them away/i }));
    await screen.findByText(/Removed 2 boxes/i);
    expect(screen.queryByText(/keep the image they were started from/i)).toBeNull();
  });
});

describe('what it says is enforced', () => {
  it('names the files an agent cannot write, not just that something is on', () => {
    show();
    // "Sandbox: enabled" would be a claim nobody can check. The panel has to say what it means.
    expect(screen.getByText(/cannot write the files that govern it/i)).toBeTruthy();
    expect(screen.getByText(/config\.yaml/)).toBeTruthy();
    // The list drifted from the profile twice. These are the two that were missing.
    expect(screen.getByText(/chat transcripts/i)).toBeTruthy();
    expect(screen.getByText(/\.git\/hooks/)).toBeTruthy();
  });

  it('carries the reason and the consequence when there is no sandbox', () => {
    show({ ok: false, profile: undefined, reason: 'the agent image is not built — run `npm run box:build`' });
    // The REASON's copy of it, not just any `box:build` on the panel: the rebuild hint names the same
    // command for the opposite purpose, and a bare match would pass with this paragraph missing.
    expect(screen.getByText(/the agent image is not built — run `npm run box:build`/)).toBeTruthy();
    // Both halves: what still works, and what will not. Either alone misleads.
    // The panel used to say manual runs and chat "still work". After the one-path ruling they are
    // refused, and an affirmative false statement about the security posture is worse than a stale
    // list — so this pins the correction.
    expect(screen.getByText(/Agents are disabled/i)).toBeTruthy();
    expect(screen.getByText(/will be refused until Docker is available/i)).toBeTruthy();
    expect(screen.queryByText(/still work;/i)).toBeNull();
  });

  it('warns about an attached server even when the profile is loaded', () => {
    // The dangerous case: everything looks fine, and the server we never spawned is unconfined.
    show({ ok: true, backend: 'attached', attachedUrl: 'http://127.0.0.1:9999' });
    expect(screen.getByText(/VibeBoard did not start/i)).toBeTruthy();
    expect(screen.getByText(/127\.0\.0\.1:9999/)).toBeTruthy();
  });
});

describe('the two actions', () => {
  it('explains what restarting does to the running session', () => {
    show();
    expect(screen.getByRole('button', { name: /restart server/i })).toBeTruthy();
    expect(screen.getByText(/Any turn in flight is lost/i)).toBeTruthy();
  });

  it('offers take-over only while attached to an external server', () => {
    show({ backend: 'managed' });
    expect(screen.queryByRole('button', { name: /take over/i })).toBeNull();
    cleanup();
    show({ backend: 'attached', attachedUrl: 'http://127.0.0.1:9999' });
    expect(screen.getByRole('button', { name: /take over/i })).toBeTruthy();
  });

  it('hides restart while attached, because it would spawn a server nothing talks to', () => {
    // opencodeBaseUrl() short-circuits to the attached URL, so the new process would just hold a
    // port while the UI reported success and the attachment warning still stood.
    show({ backend: 'attached', attachedUrl: 'http://127.0.0.1:9999' });
    expect(screen.queryByRole('button', { name: /restart server/i })).toBeNull();
    expect(screen.getByRole('button', { name: /take over/i })).toBeTruthy();
  });

  it('offers neither for Claude Code', () => {
    // It spawns a process per turn and has no persistent server, so a restart button would be a lie.
    show({ backend: 'attached', attachedUrl: 'http://127.0.0.1:9999' }, 'claude-code');
    expect(screen.queryByRole('button', { name: /restart server/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /take over/i })).toBeNull();
  });

  it('calls restart, and only restart', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: /restart server/i }));
    await waitFor(() => expect(api.restartOpencodeServer).toHaveBeenCalledTimes(1));
    // The two actions are one line apart and do different things to somebody's session.
    expect(api.takeOverOpencodeServer).not.toHaveBeenCalled();
  });

  it('shows the failure instead of silently doing nothing', async () => {
    api.restartOpencodeServer.mockRejectedValueOnce(new Error('opencode serve exited (1)'));
    show();
    fireEvent.click(screen.getByRole('button', { name: /restart server/i }));
    expect(await screen.findByText(/opencode serve exited \(1\)/)).toBeTruthy();
  });
});

// The escape hatch for a box that has drifted. `ensure` adopts a healthy box rather than remaking it, so
// there is no other way to be rid of one — and the copy has to be exact about what it costs, because
// "rebuild" reads as the image build that takes minutes and is not what this does.
describe('rebuilding the boxes', () => {
  const press = () => fireEvent.click(screen.getByRole('button', { name: /rebuild the agent boxes/i }));
  const answer = () => fireEvent.click(screen.getByRole('button', { name: /throw them away/i }));

  it.each(['opencode', 'claude-code'])('is offered for %s — every project has boxes', (backend) => {
    show({}, backend);
    expect(screen.getByRole('button', { name: /rebuild the agent boxes/i })).toBeTruthy();
  });

  it('says what is lost, and that the image is not rebuilt', () => {
    show();
    expect(screen.getByText(/Anything in flight inside them is lost/i)).toBeTruthy();
    expect(screen.getByText(/next agent turn builds new ones/i)).toBeTruthy();
    // The one people would otherwise assume. Building the IMAGE takes minutes and is a different fix —
    // and since 2026-09-01 it is an action in the product rather than a command in a terminal, so the
    // copy no longer names one. That is what this second assertion is about: the panel must not send
    // anyone to `npm run box:build`, which an installed copy does not have.
    expect(screen.getByText(/image is not rebuilt/i)).toBeTruthy();
    expect(screen.queryByText(/npm run/)).toBeNull();
  });

  // THE POINTER THAT POINTED AT NOTHING. The confirm called the image build "the button above", and on
  // a machine whose image existed there was no button above.
  it('does not send anyone to a button that may not be on screen', async () => {
    show();
    press();
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).not.toContain('the button above');
    expect(dialog.textContent).toContain('missing or out of date');
  });

  it('asks first, and calls nothing if the question is cancelled', async () => {
    show();
    press();
    fireEvent.click(await screen.findByRole('button', { name: /^cancel$/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.rebuildBoxes).not.toHaveBeenCalled();
  });

  it('calls the API once confirmed, refreshes the panel, and says how many went', async () => {
    const onChanged = vi.fn();
    render(<SandboxPanel state={state()} bump={0} backend="opencode" onChanged={onChanged} />);
    press();
    answer();
    await waitFor(() => expect(api.rebuildBoxes).toHaveBeenCalledTimes(1));
    expect(onChanged).toHaveBeenCalledTimes(1);
    // The count, not a bare "done": on a project with no boxes this control fixed nothing, and saying
    // otherwise sends someone away from the real problem.
    expect(await screen.findByText(/Removed 2 boxes/i)).toBeTruthy();
    // The three actions sit one above the other and do different things to somebody's session.
    expect(api.restartOpencodeServer).not.toHaveBeenCalled();
    expect(api.takeOverOpencodeServer).not.toHaveBeenCalled();
  });

  it('says plainly when there was nothing to remove', async () => {
    api.rebuildBoxes.mockResolvedValueOnce({ ok: true, removed: 0 });
    show();
    press();
    answer();
    expect(await screen.findByText(/no boxes for this project/i)).toBeTruthy();
  });

  it('spins the button that was pressed, not the one beside it', async () => {
    // A shared busy flag would put "Restarting…" on screen for this press. Held open by a promise that
    // never settles, because the busy state is cleared in a `finally` the moment the call returns.
    api.rebuildBoxes.mockReturnValueOnce(new Promise(() => {}));
    show();
    press();
    answer();
    expect(await screen.findByRole('button', { name: /throwing away…/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /restart server/i })).toBeTruthy();
  });

  it('shows the server’s refusal rather than failing silently', async () => {
    api.rebuildBoxes.mockRejectedValueOnce(
      new Error('1 agent is running on this project, so throwing the boxes away would kill it mid-turn.'),
    );
    show();
    press();
    answer();
    expect(await screen.findByText(/1 agent is running on this project/)).toBeTruthy();
  });
});
