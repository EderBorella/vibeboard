// THE STATE VOCABULARY, IN ONE PLACE. Phase 13 of docs/design-system.md.
//
// Before this file there were SIX independent state vocabularies and 26 `[data-state]` rules, each
// mapping its own words to a colour by hand — and four separate mechanisms for showing a state: a
// `Chip` with `state=`, a `data-state` on something that is not a Chip, a `Dot` with `tone=`, and a
// class composed at run time (`ap-bar-${tone}`, `msg-${kind}`). Nothing said which token meant what,
// so one state rendered as three colours and three states rendered as one.
//
// THE MEASURED EVIDENCE, and it is why a table rather than a tidy-up. `running` was `--text` on a
// report chip, `--accent-2` on the top bar's chip and `--accent` on the auto-pilot bar's rail — three
// colours for one fact, on three surfaces a person reads together. `complete` was `--accent` on the
// chip and `--ok` on the rail. "Good" was `--accent` on four surfaces and `--ok` on one, while `--ok`
// itself was referenced by a single rule and by no chip at all.
//
// A SURFACE MAY KEEP ITS SHAPE AND MAY NOT CHOOSE ITS COLOUR. The rail on the auto-pilot bar is still
// a 3px left border, the connection light is still a dot beside a word, the chat error is still a line
// of prose — but every one of them takes its colour from the row below, through the single custom
// property `--tone` that molecules/tones.css assigns from this table. There is no second opinion left to
// have.
//
// WHAT A TONE MEANS, said once so a new state has somewhere to go:
//   ok       it worked, or it is working as intended        --ok
//   accent   work is in flight right now                    --accent
//   warn     look at this; you can still work               --warn
//   bad      this is broken; something you wanted is gone   --danger
//   neutral  inert — no fault, no progress, nothing to do   --muted
export type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'bad';

export const TONES: readonly Tone[] = ['neutral', 'accent', 'ok', 'warn', 'bad'];

// EVERY STATE NAME IN THE APP. Grouped by the surface that says it, because that is how a reader
// arrives here — but the grouping is a comment and nothing more: two surfaces saying the same word get
// the same colour, and that is the whole point of one table.
//
// WHAT WAS JUDGED EQUIVALENT, and the reasoning is recorded here rather than in docs/ because it is
// three lines and it binds this object:
//
//   `closed`, `unauthorized`, `failed`, `interrupted`, `cancelled`, `halted`, `blocked` and
//   `unavailable` are ONE tone. Every one of them means a thing you wanted did not happen and will not
//   happen without you. A colour cannot say WHICH — that is what the word beside it and the balloon
//   under it are for, and `lightAdvice` already writes five different remedies for the six the light
//   can report.
//
//   `offline`, `failing`, `attention` and `active` are ONE tone. Every one of them means something
//   wants your attention while the app keeps working: the project cannot run agents but the board,
//   the log and the Explorer all still do; the last runs died but nothing is refusing; a run wants a
//   decision; an agent filed a finding. `--warn` is the attention token, and `--accent-2` — which
//   three of these used to take — is the palette's SECONDARY HUE and not a state colour. That is the
//   ruling on the two tokens that both meant "needs attention".
//
//   `idle` and `stopped` are ONE tone, which the transport dot already rendered by omission. Neither
//   is a fault and neither is progress. What tells them apart is that `idle` renders no chip in the
//   top bar at all while `stopped` renders one — a presence, which is a stronger signal than two
//   greys nobody can distinguish.
//
// AND WHAT WAS SPLIT RATHER THAN MERGED. `offline` and `closed` were both "not right" and are two
// tones now, because they are two facts with two remedies: `closed` means nothing on the page is
// updating, `offline` means the page is live and this project cannot run an agent. connection-light.ts
// argues that order at length and it is honoured here rather than flattened.
//
// A BACKEND NAME IS NOT A STATE, so `claude-code` and `opencode` have no rows. They were `--accent`
// and `--accent-2` on `.chat-backend` — two of the palette's hues spent on which of two agents a chat
// ran on, which is the same category error as `--accent-2` meaning both "secondary" and "attention".
// The chip is `neutral` now and the word says which, exactly as `.conn-status` distinguishes two
// states that share a colour.
export const STATE_TONES = {
  // The connection light — app/connection-light.ts, LIGHT_STATES.
  online: 'ok',
  connecting: 'accent',
  closed: 'bad',
  unauthorized: 'bad',
  offline: 'warn',
  // Said by the light AND by the auto-pilot bar's agent chip, about the same fact: the last runs died
  // before reaching a model. One word, one row, one colour — it used to be `--accent-2` in the top bar
  // and `--warn` on the bar below it.
  failing: 'warn',

  // A run's status — api/runs.ts, RunStatus.
  queued: 'accent',
  running: 'accent',
  success: 'ok',
  attention: 'warn',
  failed: 'bad',
  cancelled: 'bad',
  interrupted: 'bad',

  // The auto-pilot loop — autopilot/transport.ts, TransportState. `running` is shared with a run's
  // status above, deliberately: it is the same fact about a different thing.
  idle: 'neutral',
  stopped: 'neutral',
  halted: 'bad',
  complete: 'ok',

  // Whether the selected agent can run — autopilot/AutopilotBar.tsx, agentStatus. These were `ok`,
  // `bad`, `warn` and `unknown`: TONE NAMES used as state names, which is the conflation this file
  // exists to end. `failing` above is the row this surface shares with the light.
  ready: 'ok',
  blocked: 'bad',
  checking: 'neutral',

  // What an agent filed — shared.ts, SUGGESTION_STATES.
  active: 'warn',
  actioned: 'ok',
  dismissed: 'neutral',

  // The copilot's backend — copilot/CopilotPanel.tsx. Was a bare `.ok`/`.down` class pair, the fifth
  // mechanism, which no census counted because neither name looked like a state.
  available: 'ok',
  unavailable: 'bad',

  // A chat line that failed — copilot/CopilotPanel.tsx. The bubble keeps its own shape; the ink is
  // this row's. Not folded into `failed`: a refused turn is not a run.
  error: 'bad',
} satisfies Record<string, Tone>;

export type StateName = keyof typeof STATE_TONES;

export const STATE_NAMES = Object.keys(STATE_TONES) as StateName[];

// THE ONE PLACE A TONE BECOMES A CLASS, and it is the only class name in the app composed from a tone
// or a state. Five rules in molecules/tones.css assign `--tone` from these, and every role — a chip's
// ink, a dot's fill, a bar's rail — reads that one property. So a surface names WHICH PROPERTY the
// tone lands on and never which colour it is.
//
// `vb-tone-` is therefore one entry on the dynamic-prefix allow-list in tools/check-class-budget.mjs
// where `ap-bar-`, `vb-chip-` and `vb-dot-`'s tone half used to be three.
export const toneClass = (tone: Tone): string => `vb-tone-${tone}`;

// A STATE'S CLASS, AND THE REASON IT IS A FUNCTION RATHER THAN A TEMPLATE AT THE CALL SITE. React
// types every `data-*` attribute as `any`, so a raw `data-state={s.state}` compiles whatever `s.state`
// is — a state with no row here would leave `--tone` unset and the colour would fall through to
// whatever was inherited, which is the `--ink` defect (see tools/check-name-resolution.mjs) wearing a
// state's clothes. Calling this is what makes the compiler check the value, so every element that
// carries a `data-state` carries this too, and tools/check-state-tones.mjs refuses one that does not.
export const stateClass = (state: StateName): string => toneClass(STATE_TONES[state]);

// THE SAME TYPE CHECK WITHOUT THE CLASS, for the one element that carries a `data-state` and takes no
// colour from it: `.suggestions-row`, whose rail says which row the action bar acts on rather than what
// state the finding is in. The attribute is still a hook a test and a reader select on, and the value
// still has to be a row — so it is checked here rather than left as the `any` React types it as. An
// inert `vb-tone-*` class would have bought the same check and also implied a colour that nothing draws.
export const asState = (state: StateName): StateName => state;
