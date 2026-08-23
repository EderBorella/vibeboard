// @vitest-environment jsdom
//
// THE STATES A PERSON ONLY SEES WHEN SOMETHING HAS ALREADY GONE WRONG.
//
// Written as a CHARACTERISATION suite, before Phase 3 of docs/design-system.md moved these markers off
// runtime-composed class names and onto the Dot and Chip primitives — and run green against the code
// as it was first, so it pins the mapping rather than describing the rewrite.
//
// It exists because of the defect shape the *Risks* section names: every one of these markers was a
// class built at run time from a prefix and a state word, so a literal grep for the class found
// nothing and 36 live classes looked dead. Deleting them would have broken every state colour on the
// auto-pilot bar, the connection light, the report chips and the chat — and ONLY in the non-default
// states. A board that has failed nothing looks perfectly correct; the colour that tells you a run
// halted is the one that has gone. Nothing else in the suite would catch it: the visual harness
// measures a board in one state, and every other UI test asserts on text.
//
// So each case asserts that a state produces a DISTINCT marker from its neighbours, not merely that
// some marker is present. A fixture that cannot tell two outcomes apart tests neither, and "the
// element has a class" is exactly that fixture.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutopilotState, Readiness, RunList, RunRecord, SandboxState } from '../web/src/lib/api.js';
import { LIGHT_STATES } from '../web/src/organisms/topbar/connection-light.js';
import type { CopilotConfig } from '../web/src/lib/shared.js';

const api = vi.hoisted(() => ({
  getReadiness: vi.fn(),
  startAutopilot: vi.fn(),
  softStopAutopilot: vi.fn(),
  killAutopilot: vi.fn(),
  acknowledgeGates: vi.fn(),
  patchConfig: vi.fn(),
  cancelRun: vi.fn(),
  isSuccessReason: (reason: string) => reason === 'complete',
}));
vi.mock('../web/src/lib/api.js', () => api);

const { AutopilotBar } = await import('../web/src/organisms/autopilot/AutopilotBar.js');
const { TopBar } = await import('../web/src/organisms/topbar/TopBar.js');
const { CardReports } = await import('../web/src/organisms/runs/CardReports.js');

const COPILOT: CopilotConfig = { backend: 'claude-code', backends: {} };
const NO_RUNS: RunList = { runs: [], active: [], queued: [] };
const READY: Readiness = {
  ok: true,
  blockers: [],
  readme: { ok: true },
  foundation: { present: [], missing: [], ok: true },
  gates: { ok: true, count: 1 },
  smoke: { ok: true },
  phases: { problems: [], count: 1 },
  unreviewedGates: [],
};
const SANDBOX_OK: SandboxState = { ok: true, backend: 'managed', agentRefusal: null, refusalKind: null };

afterEach(cleanup);
beforeEach(() => {
  api.getReadiness.mockReset().mockResolvedValue(READY);
  api.patchConfig.mockReset().mockResolvedValue({});
});

// THE COLOUR THE STYLESHEET GIVES THIS ELEMENT, not the class name that carries it.
//
// The first version of this helper compared class strings, and it was wrong in both directions —
// which is the whole reason it is written this way. `.ap-dot-idle` and `.ap-dot-stopped` do not
// EXIST: both states fall through to `.ap-dot`'s grey, so two different class strings are one
// colour. And `.chip-failed`, `.chip-interrupted` and `.chip-cancelled` are three class names
// declaring the same `--danger` on purpose — "what they have in common is no report". A test
// comparing names calls those four a difference and this one does not.
//
// READ OUT OF THE SOURCE, because jsdom loads no CSS and computes no cascade: `getComputedStyle`
// answers '' whatever the rule says. `el.matches()` does the selector work, so a descendant rule
// like `.conn-closed .conn` resolves properly rather than by string surgery — and the union is taken
// over the element AND its ancestors, since that is what the eye gets when a tone is set on a
// wrapper to tint a dot and a word together.
//
// `--tone` IS IN THE LIST AND IT IS THE MOST IMPORTANT ENTRY SINCE PHASE 13. Every toned surface now
// declares the same string — `color: var(--tone)`, `border-left: 3px solid var(--tone, var(--border))` —
// and the five `.vb-tone-*` rules are where the difference lives. Without this entry every state on a
// surface reads as one marker and every distinctness claim below passes vacuously, which is exactly what
// happened when the property was introduced: eight assertions went red for the right reason and would
// have gone green again for the wrong one.
const TINTED = [
  'color',
  'background',
  'background-color',
  'border-color',
  'border',
  'border-left',
  'border-left-color',
  'box-shadow',
  '--tone',
] as const;

// EVERY SHEET THE APP LOADS, out of the app's own list: `styles.css` is 47 layer files now, and a
// hand-written list of them would go stale on the phase that adds a sheet — silently, because a rule
// this census never reads is a rule it never objects to.
const SHEETS = [
  ...readFileSync(join(process.cwd(), 'web', 'src', 'styles.ts'), 'utf8').matchAll(
    /^\s*import\s+'\.\/([^']+\.css)';/gm,
  ),
].map(([, file]) => file);

const RULES: { sel: string; body: string }[] = (() => {
  const out: { sel: string; body: string }[] = [];
  for (const file of SHEETS) {
    const css = readFileSync(join(process.cwd(), 'web', 'src', file), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      out.push({ sel: (m[1] ?? '').trim(), body: m[2] ?? '' });
    }
  }
  // A CENSUS OF NOTHING PASSES EVERY CLAIM IT MAKES, so the sheet list is floored where it is read. The
  // list comes out of `styles.ts` by regex: if that stops matching, `RULES` is empty and every tone
  // assertion below compares an element against no rules at all.
  if (out.length < 200) {
    throw new Error(
      `${out.length} rule(s) read from ${SHEETS.length} sheet(s) named in web/src/styles.ts — the ` +
        `stylesheet list or the rule regex has stopped matching, so this census is vacuous.`,
    );
  }
  return out;
})();

// Does any comma-separated part of this selector match the element? Pseudo-classes and at-rule
// preludes are skipped: they are not the resting state, and `:hover` deliberately drops the state
// colour — including it would make every state look alike. A selector jsdom cannot parse throws, and
// throwing is not matching.
function selects(el: Element, sel: string): boolean {
  return sel.split(',').some((part) => {
    const one = part.trim();
    if (!one || one.startsWith('@') || one.includes(':')) return false;
    try {
      return el.matches(one);
    } catch {
      return false;
    }
  });
}

function declared(body: string): string[] {
  return TINTED.flatMap((prop) => {
    const m = new RegExp(`(?:^|[;{\\s])${prop}\\s*:([^;}]*)`).exec(body);
    return m ? [`${prop}:${(m[1] ?? '').trim()}`] : [];
  });
}

function tintOf(el: Element): string[] {
  return RULES.filter(({ sel }) => selects(el, sel)).flatMap(({ body }) => declared(body));
}

// THE ELEMENT'S OWN COLOUR. Used where the claim is about one box — the transport dot is grey or it
// is not, whatever the bar behind it does.
function ownTint(el: Element | null | undefined): string {
  if (!el) return '<missing>';
  return [...new Set(tintOf(el))].sort().join(' | ');
}

// THE WHOLE WIDGET'S COLOUR: this element, its ancestors and its descendants. All three directions
// are load-bearing and each was found by a failure of a narrower version.
//   ANCESTORS, because the connection light and the agent chip both put the tone on a WRAPPER so it
//   tints a dot and a word together — the wrapper is the only element that knows the state.
//   DESCENDANTS, because the tone then only shows up in rules like `.conn-online .conn`, so the
//   wrapper's own declarations are identical in every state and a wrapper-only reading called
//   `online` and `offline` the same thing.
function marker(el: Element | null | undefined): string {
  if (!el) return '<missing>';
  const found: string[] = [];
  for (let node: Element | null = el; node && node.tagName !== 'BODY'; node = node.parentElement) {
    found.push(...tintOf(node));
  }
  for (const node of Array.from(el.querySelectorAll('*'))) found.push(...tintOf(node));
  return [...new Set(found)].sort().join(' | ');
}

// EVERY STATE IN A GROUP RENDERS THE SAME MARKER, AND NO TWO GROUPS RENDER THE SAME ONE.
//
// The shape the report-chip case below already had inline, lifted out because Phase 13 gave it to two
// more surfaces. It is the only honest shape once states are deliberately equal: `failed`,
// `interrupted` and `cancelled` were one colour before this phase — "what they have in common is no
// report" — and `closed`/`unauthorized` and `offline`/`failing` and `idle`/`stopped` are three more
// pairs now. BOTH halves are load-bearing: "the group is one colour" is what catches a member drifting
// out, and "the groups differ" is what catches the collapse.
function expectGroups(what: string, groups: Map<string, Map<string, string>>): void {
  const oneEach = new Map<string, string>();
  for (const [group, members] of groups) {
    const [[first, expected]] = [...members];
    for (const [state, value] of members) {
      expect(value, `${what}: ${state} must render exactly what ${first} does — they are one tone`).toBe(
        expected,
      );
    }
    oneEach.set(group, expected);
  }
  expectAllDistinct(what, oneEach);
}

// Every state produces a marker, and no two states in the list produce the same one.
function expectAllDistinct(what: string, markers: Map<string, string>): void {
  for (const [state, value] of markers) {
    expect(value, `${what}: ${state} has no marker at all`).not.toBe('<missing>');
    expect(value, `${what}: ${state} carries no class or data attribute`).not.toBe('');
  }
  const seen = new Map<string, string>();
  for (const [state, value] of markers) {
    const clash = seen.get(value);
    expect(clash, `${what}: ${state} and ${clash} are indistinguishable — both render "${value}"`).toBe(
      undefined,
    );
    seen.set(value, state);
  }
}

async function bar(state: AutopilotState | null, sandbox: SandboxState | null = SANDBOX_OK) {
  render(
    <AutopilotBar
      state={state}
      runs={NO_RUNS}
      bump={0}
      copilot={COPILOT}
      sandbox={sandbox}
      onChanged={vi.fn()}
      onBackendChanged={vi.fn()}
      onSettings={vi.fn()}
    />,
  );
  await waitFor(() => expect(api.getReadiness).toHaveBeenCalled());
}

// The five tones `transportModel` can produce, each with a state that reaches it. `stopped` and
// `complete` are the pair that must never coincide: an exhausted budget ends tidily and does not mean
// the work is done.
const AUTOPILOT_STATES: Array<[string, AutopilotState | null]> = [
  ['idle', { state: 'idle', iteration: 0 }],
  ['running', { state: 'running', iteration: 1 }],
  ['halted', { state: 'halted', iteration: 1 }],
  ['stopped', { state: 'stopped', iteration: 1, reason: 'stalled' }],
  ['complete', { state: 'stopped', iteration: 1, reason: 'complete' }],
];

describe('the auto-pilot bar says its state in a way a glance can tell apart', () => {
  // FOUR GROUPS AND NOT FIVE, since Phase 13, and the change is `idle` joining `stopped`.
  //
  // The bar's rail was `--border` for `idle` — by OMISSION, since no `.ap-bar-idle` rule existed — and
  // `--muted` for `stopped`. Two greys, and this assertion is the only thing in the repository that
  // ever claimed a person could tell them apart. Both are the `neutral` row now: neither is a fault and
  // neither is progress, which is the reading the transport dot beside them already rendered and which
  // the test below has recorded as deliberate since Phase 3.
  //
  // WHAT DISTINGUISHES THEM INSTEAD IS A PRESENCE RATHER THAN A COLOUR: `chipFor` returns null for
  // `idle`, so the top bar renders NO chip at all, and renders one for `stopped`. That is asserted by
  // *gives each auto-pilot state a distinct marker* below, which skips `idle` for exactly that reason.
  it('gives the bar itself a distinct marker per tone', async () => {
    const groups = new Map([
      ['inert', ['idle', 'stopped']],
      ['running', ['running']],
      ['halted', ['halted']],
      ['complete', ['complete']],
    ]);
    const measured = new Map<string, Map<string, string>>();
    for (const [group, names] of groups) {
      const inGroup = new Map<string, string>();
      for (const name of names) {
        cleanup();
        const found = AUTOPILOT_STATES.find(([n]) => n === name);
        if (!found) throw new Error(`no auto-pilot state named ${name}`);
        await bar(found[1]);
        inGroup.set(name, marker(screen.getByTestId('ap-bar')));
      }
      measured.set(group, inGroup);
    }
    expectGroups('the bar', measured);
  });

  // THE DOT IS INSIDE THE CHIP NOW, and `ap-tone-dot` is gone with the bare `<Dot>` it named. So this
  // reads the chip's own tint rather than the dot's: the chip is the element that knows the state, and the
  // dot inside it takes the fill from `currentColor`, which is the construction every indicator in the app
  // now shares. `ownTint` and not `marker` for that reason — the tone is ON this element, not on an
  // ancestor, and reading the subtree would let the dot's inherited colour answer for the chip's.
  it('gives the transport chip a distinct marker per tone', async () => {
    const markers = new Map<string, string>();
    for (const [name, state] of AUTOPILOT_STATES) {
      cleanup();
      await bar(state);
      markers.set(name, ownTint(screen.getByTestId('ap-chip')));
    }
    // `idle` and `stopped` ARE THE SAME GREY, deliberately: neither is a fault and neither is
    // progress, and no rule for either exists — both fall through to the dot's default. Recorded
    // rather than asserted away, because the bar's own left border is what separates them and this
    // is the pair a name-comparing version of this test called a difference.
    expect(markers.get('idle'), 'idle and stopped are one colour, by omission').toBe(markers.get('stopped'));
    const loud = new Map([...markers].filter(([name]) => name !== 'stopped'));
    expectAllDistinct('the transport chip', loud);
  });

  it('distinguishes the play control from the stop control', async () => {
    cleanup();
    await bar({ state: 'idle', iteration: 0 });
    const play = marker(screen.getByTestId('ap-transport'));
    cleanup();
    await bar({ state: 'running', iteration: 1 });
    const stop = marker(screen.getByTestId('ap-transport'));
    expect(play, 'play and stop render the same control').not.toBe(stop);
  });

  // The chip that said "Ready" while three runs in a row died before reaching a model. Its four tones
  // are the reason it exists, and `ok` versus `warn` is the pair that was wrong.
  it('gives the agent chip a distinct marker per readiness tone', () => {
    const cases: Array<[string, SandboxState | null]> = [
      ['unknown', null],
      ['ok', SANDBOX_OK],
      ['bad', { ok: false, backend: 'managed', agentRefusal: 'no docker', refusalKind: 'docker' }],
      [
        'warn',
        {
          ok: true,
          backend: 'managed',
          agentRefusal: null,
          refusalKind: null,
          recentFailure: { runs: 3, note: 'never reached a model', at: '2026-08-16T10:00:00.000Z' },
        },
      ],
    ];
    const markers = new Map<string, string>();
    for (const [name, sandbox] of cases) {
      cleanup();
      render(
        <AutopilotBar
          state={{ state: 'idle', iteration: 0 }}
          runs={NO_RUNS}
          bump={0}
          copilot={COPILOT}
          sandbox={sandbox}
          onChanged={vi.fn()}
          onBackendChanged={vi.fn()}
          onSettings={vi.fn()}
        />,
      );
      markers.set(name, marker(screen.getByTestId('ap-agent-state')));
    }
    expectAllDistinct('the agent chip', markers);
  });
});

describe('the top bar', () => {
  const props = {
    showProject: true,
    projectName: 'Demo',
    tab: 'boards' as const,
    onTab: vi.fn(),
    theme: 'cyberpunk',
    onTheme: vi.fn(),
    copilotOpen: true,
    onToggleCopilot: vi.fn(),
    onSettings: vi.fn(),
    onSwitchProject: vi.fn(),
    attentionCount: 0,
    light: 'online' as const,
    lightTitle: 'Connected.',
    agentRefusal: null,
    refusalKind: null,
    recentFailure: null,
  };

  // ITS AUTO-PILOT CHIP IS GONE, and *gives each auto-pilot state a distinct marker* went with it — the
  // claim is asserted one describe above, on the bar, which is where the chip now lives. What is left here
  // is the guard: the header must carry exactly ONE toned indicator, the connection light. A second one
  // returning is the thing this file exists to notice, because two indicators for one fact is how a
  // vocabulary splits in the first place.
  it('carries exactly one toned indicator, the connection light', () => {
    const { container } = render(<TopBar {...props} />);
    const toned = Array.from(container.querySelectorAll('[data-state]'));
    expect(toned.map((el) => (el as HTMLElement).dataset.testid)).toEqual(['conn-status']);
  });

  // THE SIX NEED FIVE DIFFERENT RESPONSES AND A COLOUR CANNOT SAY WHICH — which was written here as an
  // argument for six colours and is, read again, the argument against them. Phase 13 makes it four
  // groups, and the WORD is what separates the members of a group: `.conn-text` is a fixed 12ch box
  // sized to the longest name the light can report, and that box exists for precisely this.
  //
  // TWO OF THE THREE PAIRS WERE ALREADY ONE COLOUR IN TWO OF THE THREE THEMES. `offline` was `--warn`
  // and `failing` was `--accent-2`, and themes.css defines those to the same amber in cyberpunk and
  // classic-dark — the rule for `failing` said so itself: "where they coincide this is distinguished
  // from `offline` by the word". So the collapse ratifies what two palettes out of three already
  // rendered, and marshmallow stops being the odd one out.
  //
  // `closed` and `unauthorized` join `bad` because both mean nothing you press will work: the page is
  // frozen, or every button on it fails. The remedy is in `lightAdvice`'s balloon, which writes five
  // different ones, and never was in the colour.
  it('gives each connection state a distinct marker', () => {
    const groups = new Map([
      ['live', ['online']],
      ['in flight', ['connecting']],
      // Ordered as `LIGHT_STATES` lists them, so a state added to that union and not to a group here
      // fails the completeness assertion below rather than being silently unmeasured.
      ['broken', ['closed', 'unauthorized']],
      ['needs attention', ['offline', 'failing']],
    ]);
    const measured = new Map<string, Map<string, string>>();
    for (const [group, states] of groups) {
      const inGroup = new Map<string, string>();
      for (const state of states) {
        cleanup();
        const { container } = render(<TopBar {...props} light={state as (typeof LIGHT_STATES)[number]} />);
        inGroup.set(state, marker(container.querySelector('[data-testid="conn-status"]')));
      }
      measured.set(group, inGroup);
    }
    expectGroups('the connection light', measured);
    // EVERY STATE THE LIGHT CAN REPORT IS IN A GROUP. Without this the groups are an allow-list: a
    // seventh state would render whatever it rendered and nothing here would look at it, which is the
    // same fall-through-to-grey defect the original version of this test was written to catch.
    expect([...groups.values()].flat().sort()).toEqual([...LIGHT_STATES].sort());
  });
});

describe('a report chip says how the run ended', () => {
  const run = (status: RunRecord['status']): RunRecord =>
    ({
      run: `r-${status}`,
      card: 'C-1',
      skill: 'build',
      status,
      started: '2026-08-16T10:00:00.000Z',
    }) as RunRecord;

  // Seven statuses, and three of them share a colour on purpose — `failed`, `interrupted` and
  // `cancelled` all mean "no report". What must NOT coincide is `success` with any of them, or
  // `attention` with either group: those are the three answers a person acts on differently.
  it('separates success, attention and the endings that produced nothing', () => {
    const groups: Array<[string, RunRecord['status'][]]> = [
      ['success', ['success']],
      ['attention', ['attention']],
      ['no report', ['failed', 'interrupted', 'cancelled']],
      ['in flight', ['running', 'queued']],
    ];
    const markers = new Map<string, string>();
    for (const [name, statuses] of groups) {
      for (const status of statuses) {
        cleanup();
        const { container } = render(
          <CardReports
            card={{ id: 'C-1', title: 'A card' } as never}
            runs={[run(status)]}
            account={null}
            onOpen={vi.fn()}
            onCancel={vi.fn()}
            onForgiven={vi.fn()}
          />,
        );
        const seen = marker(container.querySelector('[data-testid="report-chip"]'));
        const already = markers.get(name);
        if (already !== undefined) {
          expect(already, `${status} must look like the rest of "${name}"`).toBe(seen);
        }
        markers.set(name, seen);
      }
    }
    expectAllDistinct('the report chip', markers);
  });
});
