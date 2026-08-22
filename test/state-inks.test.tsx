// @vitest-environment jsdom
//
// THE SAME TONE IS THE SAME INK ON EVERY SURFACE THAT SHOWS IT, ON ALL THREE THEMES.
//
// test/chip-boxes.test.tsx already makes this claim for THREE tones on ONE surface — the card tile's
// three state words — and says why it has to be measured rather than inferred: `--warn` and `--danger`
// are the same value in cyberpunk and classic-dark and different in marshmallow, so "they name
// different tokens" is not the same claim as "they render differently". This is that claim widened to
// every surface in the app, which is what Phase 13 of docs/design-system.md owes.
//
// WHAT IT WOULD HAVE CAUGHT BEFORE THE PHASE, and this is the measurement rather than a hypothesis:
// `running` rendered `--text` on a report chip, `--accent-2` on the top bar's chip and `--accent` on
// the auto-pilot bar's rail. Three colours, one fact, three surfaces a person reads in one glance.
// `complete` was `--accent` on the chip and `--ok` on the rail. Nothing in the suite could see either,
// because every assertion about a state's colour was made per surface.
//
// THE ONE PLACE A TONE IS LEGITIMATELY TWO TOKENS is a Dot against a Chip: a dot is a filled disc and a
// chip is ink on a ground, so `background` and `color` carry the tone on the two. That is not two
// colours — both resolve to the SAME token, which is exactly what this file measures. The roles are
// asserted separately below and the resolved value is asserted equal across them.
//
// jsdom LOADS NO CSS and computes no cascade, so the sheets are read out of the source and
// `el.matches()` does the selector work — the construction test/css-box.tsx, test/panel-boxes.test.tsx,
// test/chip-boxes.test.tsx and test/state-tones.test.tsx all use. The resolver is test/state-ink.tsx.
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutopilotState, Readiness, RunList, RunRecord, SandboxState } from '../web/src/api.js';
import { LIGHT_STATES } from '../web/src/app/connection-light.js';
import type { CopilotConfig, Suggestion } from '../web/src/shared.js';
import { STATE_TONES, type StateName, TONES, type Tone } from '../web/src/ui/state-tones.js';
import { inkIn, isColour, THEMES } from './state-ink.js';

const api = vi.hoisted(() => ({
  getReadiness: vi.fn(),
  startAutopilot: vi.fn(),
  softStopAutopilot: vi.fn(),
  killAutopilot: vi.fn(),
  acknowledgeGates: vi.fn(),
  patchConfig: vi.fn(),
  cancelRun: vi.fn(),
  addDiaryEntry: vi.fn(),
  isSuccessReason: (reason: string) => reason === 'complete',
}));
vi.mock('../web/src/api.js', () => api);

const { AutopilotBar } = await import('../web/src/autopilot/AutopilotBar.js');
const { TopBar } = await import('../web/src/app/TopBar.js');
const { CardReports } = await import('../web/src/runs/CardReports.js');
const { DiaryView } = await import('../web/src/diary/DiaryView.js');

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

const topBarProps = {
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

const runRecord = (status: RunRecord['status']): RunRecord =>
  ({
    run: `r-${status}`,
    card: 'C-1',
    skill: 'build',
    status,
    started: '2026-08-16T10:00:00.000Z',
  }) as RunRecord;

const filed = (state: Suggestion['state']): Suggestion => ({
  id: `s-${state}`,
  state,
  created: '2026-08-16T10:00:00.000Z',
  title: `A ${state} finding`,
  body: 'What it said.',
});

// ---------------------------------------------------------------------------------------------------
// EVERY SURFACE THAT SHOWS A STATE, rendered through ITS OWN COMPONENT and never through a hand-written
// class list. Phase 8 and Phase 4 both recorded what a class-list fixture costs — the assertions survive
// a migration and the fixtures do not, so a hand-written list quietly tests a dead class. And the
// specific defect that shape cannot see is the one this phase is about: a surface whose call site lost
// `state=` would leave the class in the stylesheet and every literal fixture green while the board
// rendered a row of identical grey words.
//
// `role` is the PROPERTY the surface spends the tone on — a chip's ink, a dot's fill, a rail's border —
// and it is part of the fixture rather than assumed, because "the same tone is the same ink" is only a
// real claim if the roles are allowed to differ.
interface Probe {
  surface: string;
  role: string;
  state: StateName;
  find: () => Promise<Element>;
}

const found = async (selector: string): Promise<Element> => {
  const el = await waitFor(() => {
    const hit = document.querySelector(selector);
    if (!hit) throw new Error(`nothing matched ${selector}`);
    return hit;
  });
  return el;
};

function connectionLight(state: (typeof LIGHT_STATES)[number]): Probe[] {
  return [
    {
      surface: 'conn-status (the word)',
      role: 'color',
      state,
      find: async () => {
        render(<TopBar {...topBarProps} light={state} />);
        return found('[data-testid="conn-status"] .conn-text');
      },
    },
    {
      // THE DOT TAKES THE WRAPPER'S TONE THROUGH `currentColor`, which is a second role for the same
      // token and the case this file exists to distinguish from a second colour.
      surface: 'conn-status (the pip)',
      role: 'background',
      state,
      find: async () => {
        render(<TopBar {...topBarProps} light={state} />);
        return found('[data-testid="conn-status"] .vb-dot');
      },
    },
  ];
}

const PROBES: Probe[] = [
  ...LIGHT_STATES.flatMap(connectionLight),

  // A run's status, on the report chip — three call sites render this chip and they are one component.
  ...(['success', 'attention', 'failed', 'interrupted', 'cancelled', 'running', 'queued'] as const).map(
    (status): Probe => ({
      surface: 'report-chip',
      role: 'color',
      state: status,
      find: async () => {
        render(
          <CardReports
            card={{ id: 'C-1', title: 'A card' } as never}
            runs={[runRecord(status)]}
            account={null}
            onOpen={vi.fn()}
            onCancel={vi.fn()}
            onForgiven={vi.fn()}
          />,
        );
        return found('[data-testid="report-chip"]');
      },
    }),
  ),

  // The loop, said in three places at once: the top bar's chip, the bar's rail and the transport dot.
  // Three surfaces, three roles, and before this phase three answers for `running` and two for
  // `complete`.
  ...(
    [
      ['running', { state: 'running', iteration: 1 }],
      ['halted', { state: 'halted', iteration: 1 }],
      ['complete', { state: 'stopped', iteration: 1, reason: 'complete' }],
      ['stopped', { state: 'stopped', iteration: 1, reason: 'stalled' }],
    ] as [StateName, AutopilotState][]
  ).flatMap(([name, autopilot]): Probe[] => [
    {
      // WAS `ap-chip (top bar)`, AND THE MOVE IS THE POINT OF THIS ROW. The loop was said in THREE places
      // at once — the header's chip, the bar's rail and the bar's transport dot — and the header's copy is
      // gone: two surfaces for one fact, not three. The chip is on the bar now, and it is the element that
      // knows the state, so `color` is still the role read.
      surface: 'ap-chip (the bar)',
      role: 'color',
      state: name,
      find: async () => {
        await bar(autopilot);
        return found('[data-testid="ap-chip"]');
      },
    },
    {
      surface: 'ap-bar (the rail)',
      role: 'border-left-color',
      state: name,
      find: async () => {
        await bar(autopilot);
        return found('[data-testid="ap-bar"]');
      },
    },
    // THE TRANSPORT DOT HAS NO PROBE OF ITS OWN ANY MORE, and it is not an omission: `ap-tone-dot` named a
    // bare `<Dot state=…>` beside the row's sentence, and the dot is inside the chip now with no state of
    // its own — it takes its fill from the chip's `currentColor`. A probe on it would be reading the row
    // above by inheritance and reporting it as a second surface agreeing, which is the shape of vacuous
    // agreement this file exists to refuse. test/state-tones.test.tsx asserts the chip's own tint.
  ]),

  // Whether the selected agent can run. `failing` is the row it SHARES with the connection light above,
  // about the same fact — the last runs died before reaching a model — and the two used to be
  // `--accent-2` in the top bar and `--warn` on the bar below it.
  ...(
    [
      ['ready', SANDBOX_OK],
      ['checking', null],
      ['blocked', { ok: false, backend: 'managed', agentRefusal: 'no docker', refusalKind: 'docker' }],
      [
        'failing',
        {
          ok: true,
          backend: 'managed',
          agentRefusal: null,
          refusalKind: null,
          recentFailure: { runs: 3, note: 'never reached a model', at: '2026-08-16T10:00:00.000Z' },
        },
      ],
    ] as [StateName, SandboxState | null][]
  ).map(
    ([name, sandbox]): Probe => ({
      surface: 'ap-agent-state',
      role: 'color',
      state: name,
      find: async () => {
        await bar({ state: 'idle', iteration: 0 }, sandbox);
        return found('[data-testid="ap-agent-state"]');
      },
    }),
  ),

  // What an agent filed, on the Project Log's right-hand column.
  ...(['active', 'actioned', 'dismissed'] as const).map(
    (state): Probe => ({
      surface: 'filed-entry (the rail)',
      role: 'border-left-color',
      state,
      find: async () => {
        api.addDiaryEntry.mockResolvedValue({});
        render(<DiaryView bump={0} />);
        return found(`.filed-entry[data-state="${state}"]`);
      },
    }),
  ),
];

// The suggestions the Project Log renders come from a hook rather than a prop, so the three states are
// supplied through the same fetch the component really makes.
vi.mock('../web/src/suggestions/useSuggestions.js', () => ({
  useSuggestions: () => ({
    suggestions: [filed('active'), filed('actioned'), filed('dismissed')],
    failed: false,
    refresh: vi.fn(),
  }),
}));
vi.mock('../web/src/diary/useDiary.js', () => ({
  useDiary: () => ({ entries: [], failed: false, refresh: vi.fn(), add: vi.fn() }),
}));

// ---------------------------------------------------------------------------------------------------
describe('one tone is one ink, whatever surface says it', () => {
  // ANTI-VACUITY BEFORE ANY COMPARISON, and it is two separate guards. A probe list that has stopped
  // covering a tone would make the claim below true of nothing; and this file naming a surface that no
  // longer renders is the shape *the harness measured the board ten times* had — coverage-looking and
  // empty.
  it('probes every one of the five tones, and every state in the table it can reach', () => {
    const tonesProbed = new Set(PROBES.map((p) => STATE_TONES[p.state]));
    expect([...tonesProbed].sort()).toEqual([...TONES].sort());
    // Every state that any probe names is a row, which the compiler already knows — asserted anyway
    // because `StateName` is only as good as the table, and this is the file that reads both.
    for (const probe of PROBES) {
      expect(STATE_TONES[probe.state], `${probe.surface} names ${probe.state}`).toBeDefined();
    }
    // More than one surface per tone, or "the same tone on every surface" is a claim about one surface.
    for (const tone of TONES) {
      const surfaces = new Set(PROBES.filter((p) => STATE_TONES[p.state] === tone).map((p) => p.surface));
      expect(surfaces.size, `${tone} is shown by ${[...surfaces].join(', ')} alone`).toBeGreaterThan(1);
    }
  });

  it.each(THEMES)('renders each tone as exactly one colour in %s', async (theme) => {
    const seen = new Map<Tone, { where: string; ink: string }>();
    const clashes: string[] = [];
    for (const probe of PROBES) {
      cleanup();
      const el = await probe.find();
      const ink = inkIn(el, theme, probe.role);
      const where = `${probe.surface} [${probe.state}] as ${probe.role}`;
      // A resolver that silently stopped working would report every surface as a distinct colour and
      // the equality below would be the only thing failing — which reads as a design fault rather than
      // as a broken instrument. Checked per probe so the failure names the surface.
      expect(isColour(ink), `${where} did not resolve to a colour: ${ink}`).toBe(true);
      const tone = STATE_TONES[probe.state];
      const already = seen.get(tone);
      if (already === undefined) seen.set(tone, { where, ink });
      else if (already.ink !== ink)
        clashes.push(`${tone}: ${already.where} is ${already.ink}, ${where} is ${ink}`);
    }
    expect(
      clashes,
      `these surfaces disagree about what a tone is worth in ${theme}. A tone may be a different\n` +
        `PROPERTY on two surfaces — a dot fills, a chip inks — but never a different colour.`,
    ).toEqual([]);
  });

  // THE OTHER HALF, and without it the claim above is satisfied by painting everything one colour. Five
  // tones, five distinct colours, in every palette — which is where marshmallow earns its place in the
  // list: it is the theme where `--warn` and `--accent-2` and `--danger` genuinely differ.
  it.each(THEMES)('keeps the five tones five distinct colours in %s', async (theme) => {
    const byTone = new Map<Tone, string>();
    for (const probe of PROBES) {
      if (byTone.has(STATE_TONES[probe.state])) continue;
      cleanup();
      const el = await probe.find();
      byTone.set(STATE_TONES[probe.state], inkIn(el, theme, probe.role));
    }
    expect([...byTone.keys()].sort()).toEqual([...TONES].sort());
    expect(new Set(byTone.values()).size, `the five tones render as ${[...byTone.values()].join(', ')}`).toBe(
      5,
    );
  });

  // THE STATES THE PHASE DELIBERATELY MERGED, asserted as merges rather than left implied — so a later
  // change that splits one of them again has to say so here.
  it.each(THEMES)('renders the pairs it merged as one colour in %s', async (theme) => {
    const inkOfState = async (state: StateName): Promise<string> => {
      const probe = PROBES.find((p) => p.state === state);
      if (!probe) throw new Error(`no probe for ${state}`);
      cleanup();
      return inkIn(await probe.find(), theme, probe.role);
    };
    // `offline`/`failing` and `closed`/`unauthorized` were four different tokens on ONE control before
    // this phase — `--warn`, `--accent-2`, `--danger`, `--warn` — which is the finding that started it.
    expect(await inkOfState('offline')).toBe(await inkOfState('failing'));
    expect(await inkOfState('closed')).toBe(await inkOfState('unauthorized'));
    // And the two that were never the same colour and had to become so: a halted loop and a failed run.
    expect(await inkOfState('halted')).toBe(await inkOfState('failed'));
  });
});
