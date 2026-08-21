import { useState } from 'react';
import {
  type AutopilotState,
  acknowledgeGates,
  killAutopilot,
  patchConfig,
  type RunList,
  type SandboxState,
  softStopAutopilot,
  startAutopilot,
} from '../api';
import { type LightAdvice, lightAdvice } from '../app/connection-light';
import { killProjectRequest } from '../confirm/requests';
import { useConfirm } from '../confirm/useConfirm';
import { BackendPicker } from '../copilot/BackendPicker';
import { resolveChoice } from '../copilot/choice';
import type { CopilotConfig } from '../shared';
import { Button } from '../ui/Button';
import { Dot, type Tone as DotTone } from '../ui/Dot';
import { Popover } from '../ui/Popover';
import { useAction } from '../useAction';
import { AutopilotHelp } from './AutopilotHelp';
import { ForgiveDerivation } from './ForgiveDerivation';
import { type Tone as TransportTone, transportModel } from './transport';
import { useReadiness } from './useReadiness';

interface Props {
  state: AutopilotState | null;
  runs: RunList;
  // Changes when the project does, so readiness is re-asked for the new one.
  bump: number;
  // The project's configured backend block. Auto-pilot has no backend of its own: the loop dispatches
  // without naming one and the server fills it from here, so this IS the agent auto-pilot runs — it had
  // simply never been shown on the surface that runs it.
  copilot: CopilotConfig;
  // Whether agents can run at all, already fetched by the shell. Threaded rather than fetched again so
  // there is one answer on screen: a second fetch would be a second opinion with its own refresh
  // schedule, and this bar and the connection light would disagree for the length of it.
  sandbox: SandboxState | null;
  onChanged: () => void;
  // Re-ask the sandbox for the backend just chosen. Separate from `onChanged`, which refreshes the
  // LOOP's state — see the note on the write below for why the distinction is the whole point.
  onBackendChanged: () => void;
  // Where the caps and the routing table live. The stops are HERE now — see below.
  onSettings: () => void;
}

// Headings for the three ways a project can be unable to run an agent. They come from `refusalKind`,
// which exists so the UI can title a refusal without parsing its sentence, and they are the same
// vocabulary the connection light's advice uses — one fault should not have two names depending on
// which corner of the chrome reports it.
const REFUSAL_WORD: Record<'docker' | 'credential' | 'attached' | 'backend', string> = {
  docker: 'No Docker',
  credential: 'Stale sign-in',
  attached: 'Not sandboxed',
  // The third kind, and it needs its own word for the same reason the others have one: without it this fell
  // through to the generic 'Blocked', which says a fault exists and nothing about which — while the remedy
  // here is a restart rather than a rebuild.
  backend: 'No agent server',
};

// WHETHER THE SELECTED AGENT CAN ACTUALLY RUN, in one word and a colour, with the server's own sentence
// underneath it as the tooltip.
//
// The sentence is NOT reworded here. It is computed on the server by the same function the dispatch
// gate calls, so restating it in our own words would be a second description of a rule this bar does
// not enforce — and two descriptions of one rule in this codebase have already drifted apart. Ours is
// the heading; the server's is the detail. That split is the one `lightAdvice` already makes.
//
// `null` is NOT ASKED YET, and must never read as "nothing is wrong". Before the answer arrives the bar
// says it is asking, which is true — showing reassurance would be a lie for the length of a round trip
// and showing an alarm would be a worse one.
// AND WHAT HAS ALREADY GONE WRONG, which this chip could not see at all.
//
// It read `agentRefusal` alone — "may an agent start right now" — so on 2026-08-16 it said "Ready" while three
// runs in a row died before reaching a model and auto-pilot stopped itself over them. Nothing was refusing:
// the box was healthy, the credential was current, and the server it talked to had been destroyed under a live
// URL. The only surface that knew was the light in the top bar, which had been given the same streak weeks
// earlier — and this is the surface with the Start button on it.
//
// THE ADVICE COMES FROM `lightAdvice`, the top bar's own function, rather than being written again here. One
// fault must not have two names depending on which corner of the chrome reports it, and this codebase has
// twice had two descriptions of one rule drift apart. What is local is the WORD, because a chip has room for
// one and a balloon does not.
//
// A REFUSAL OUTRANKS A STREAK, the same order `lightFor` uses: both are usually true together — a streak is
// what a refusal was causing — and the one that stops you working now is the one worth the word.
export function agentStatus(sandbox: SandboxState | null): {
  word: string;
  tone: 'ok' | 'bad' | 'warn' | 'unknown';
  title: string;
  advice?: LightAdvice;
} {
  if (!sandbox) {
    return { word: 'Checking…', tone: 'unknown', title: 'Asking the server whether this agent can run.' };
  }
  if (sandbox.agentRefusal) {
    return {
      word: sandbox.refusalKind ? REFUSAL_WORD[sandbox.refusalKind] : 'Blocked',
      tone: 'bad',
      title: sandbox.agentRefusal,
      advice: lightAdvice('offline', sandbox.agentRefusal, sandbox.refusalKind),
    };
  }
  if (sandbox.recentFailure) {
    return {
      // NOT 'Ready', and not 'Blocked' either: nothing is refusing, so a word implying a gate would describe
      // one that does not exist. What is true is that the last runs failed before reaching a model.
      word: 'Failing',
      tone: 'warn',
      title: sandbox.recentFailure.note,
      advice: lightAdvice('failing', null, null, sandbox.recentFailure),
    };
  }
  return { word: 'Ready', tone: 'ok', title: 'This agent has what it needs to run in this project.' };
}

// A WORD PLUS A BALLOON, because the word alone cannot carry a remedy — and this is the surface with the Start
// button on it, so the explanation belongs one click away rather than one surface away. The same pattern, and
// the same sentences, as the light in the top bar.
//
// A healthy agent stays a plain chip: there is nothing to explain, and a balloon that opens onto "everything
// is fine" teaches people that opening it is not worth it.
//
// Its own component because the bar was already at the complexity limit and this is the second conditional
// rendering in it — the gate refusing the third one is the gate working.
function AgentChip({ agent }: { agent: ReturnType<typeof agentStatus> }) {
  // THE TONE IS A `data-tone` ATTRIBUTE AND NO LONGER A CLASS NAME BUILT AT RUN TIME. `ap-agent-${tone}`
  // produced four classes no literal grep could see, which is the defect the *Risks* section of
  // docs/design-system.md describes: 36 live classes looked dead, and deleting them would have broken every
  // state colour on this bar in exactly the states a person only reaches once something has gone wrong.
  // A `data-` value is visible to the same grep that reads the stylesheet's own selector.
  //
  // ONLY THE FAULT GETS A COLOUR, so `ok` and `unknown` are the muted word with a dot that differs — see
  // styles.css. The dot's tone is therefore NOT the word's: `ok` is a green pip beside grey text.
  const dot = <Dot size={7} tone={agent.tone === 'ok' ? 'ok' : undefined} />;
  if (!agent.advice) {
    return (
      <span
        className="ap-agent-state"
        data-state={agent.tone}
        data-testid="ap-agent-state"
        title={agent.title}
      >
        {dot}
        {agent.word}
      </span>
    );
  }
  return (
    <Popover
      label="What is wrong with this agent"
      triggerClassName="ap-agent-state"
      triggerTitle={agent.title}
      // ON THE TRIGGER, not on the content. It used to sit on the inner span so one selector would find
      // this chip whether it was a plain span or a button with a balloon — and that made
      // `test/autopilot-bar.test.tsx`'s `expect(badge.className).not.toContain('ap-agent-ok')` VACUOUS in
      // every case that has a balloon, because the inner span never carried a tone at all. The tone and
      // the test id now sit on the same element in both shapes, which is what that assertion needed.
      triggerTestId="ap-agent-state"
      triggerState={agent.tone}
      trigger={
        <>
          {dot}
          {agent.word}
        </>
      }
    >
      <strong className="ap-agent-heading">{agent.advice.heading}</strong>
      <p className="ap-agent-detail">{agent.advice.detail}</p>
      {agent.advice.next && <p className="ap-agent-next">{agent.advice.next}</p>}
    </Popover>
  );
}

// THE TRANSPORT DOT'S TONE, as a table rather than as a class name composed from the state word.
// `ap-dot-${tone}` created four classes, and only THREE of them existed in the stylesheet: `idle` and
// `stopped` both fell through to the base rule's grey, which is right — neither is a fault and neither
// is progress — but it was true by omission, so nothing said so and nothing could check it. Stated here
// instead, and pinned by test/state-tones.test.tsx, which asserts the pair is one colour on purpose.
//
// `running` is the only one that moves. The pulse belongs to the Dot because the reduced-motion
// override that switches it off has to sit beside the keyframes.
const DOT_TONE: Record<TransportTone, DotTone> = {
  idle: 'neutral',
  stopped: 'neutral',
  running: 'accent',
  halted: 'bad',
  complete: 'ok',
};

function ToneDot({ tone }: { tone: TransportTone }) {
  return <Dot size={8} tone={DOT_TONE[tone]} pulse={tone === 'running'} testId="ap-tone-dot" />;
}

// THE ONE BIG BUTTON. Its own component for the reason AgentChip is: the bar sits on the
// cognitive-complexity limit, and the gate refusing one more conditional in it is the gate working.
//
// `primary` to start and `default` to stop — the two are the same box in the same place, and the one
// that begins work is the one that should read as the action. That is exactly what `.ap-transport` and
// `.ap-transport-stop` said before the variant existed.
function Transport({
  control,
  onAct,
}: {
  control: ReturnType<typeof transportModel>['control'];
  onAct: () => void;
}) {
  const stopping = control.kind === 'stop';
  return (
    <Button
      variant={stopping ? 'default' : 'primary'}
      size="md"
      className="ap-transport"
      data-testid="ap-transport"
      disabled={control.disabled}
      title={control.title}
      aria-label={control.label}
      onClick={onAct}
    >
      <span aria-hidden="true">{stopping ? '■' : '▶'}</span>
      {control.label}
    </Button>
  );
}

// The transport strip: play, what it is doing, what is missing, and how it works.
//
// It exists because "hit play and watch it move" was, until now, four clicks into a settings modal and a
// scroll past the copilot and sandbox sections — and the only thing on the board itself was a
// one-word chip whose explanation was in a `title` attribute nobody hovers.
//
// Deliberately NOT the whole panel — the caps and the routing table stay in Settings. Every CONTROL is
// here, though, including the two that used to be behind that modal:
//
//  - **The emergency stop.** It was Settings-only, on the reasoning that a kill button on the header is
//    one somebody presses by accident. That trade was wrong: the thing you most want to kill is a loop
//    that is running right now, and reaching it meant opening a modal on top of the board you are
//    watching. The accident is guarded by a confirm dialog that names what dies, which is the right
//    place for that guard.
//  - **The gate acknowledgement.** It was inside this bar's own drawer, behind a disclosure arrow, while
//    Settings had a Start button and no way to clear the block at all. A user hit exactly that: told to
//    read the commands in Project Control, then refused again, with the only control on another surface.
//    It is on the bar now, LAST in the row, so that when it disappears nothing else moves.
export function AutopilotBar({
  state,
  runs,
  bump,
  copilot,
  sandbox,
  onChanged,
  onBackendChanged,
  onSettings,
}: Props) {
  const [open, setOpen] = useState(false);
  // The server's own words on a refusal. A refusal names what is missing, and swallowing it turns the
  // button into one that does nothing for no stated reason.
  const { busy, error, run } = useAction();
  // ITS OWN ACTION, not the transport's. Sharing one would make the play button read "Starting…" and
  // the emergency stop go dead while a backend write is in flight — two controls reporting an act that
  // is not theirs.
  const { busy: switching, error: switchError, run: runSwitch } = useAction();
  const [helpOpen, setHelpOpen] = useState(false);
  // Re-asked whenever the project changes or the loop's state does: fixing a blocker and pressing play
  // should not require a reload, and stopping may have been caused by one.
  // Bumped locally as well, so acknowledging the gate review refetches readiness immediately rather
  // than waiting for whatever else happens to change.
  const [reviewed, setReviewed] = useState(0);
  const { confirm, dialog } = useConfirm();
  const { readiness } = useReadiness(`${bump}:${state?.state ?? 'none'}:${reviewed}`);
  const model = transportModel({ state, runs, readiness, starting: busy !== null });
  const backend = resolveChoice(copilot, {}).backend;
  const agent = agentStatus(sandbox);

  // ONE SHARED SETTING, WRITTEN TO DISK — and that is the property the whole control stands on.
  //
  // The auto-pilot loop is a separate process that reads `config.copilot.backend` from the file; a
  // selector that only moved browser state would name the thing it does not control, which is worse
  // than having no selector at all. So this writes the same value Settings writes, through the same
  // endpoint, and the consequence is on the buttons: the copilot's default and manual dispatches move
  // with it. The dock's selector stays a session override and follows this one, because
  // `useCopilotChoice` clears its override whenever the configured block changes.
  //
  // The whole block is spread back, not `{ backend }` alone: `backends` holds each agent's remembered
  // model, and the per-backend slots exist to stop one choice discarding the other's.
  function chooseBackend(next: string): void {
    if (next === backend) return;
    void runSwitch(async () => {
      await patchConfig({ copilot: { ...copilot, backend: next } });
      // AFTER the write lands, and it is not optional. `useSandbox` is keyed on the shell's counter,
      // not on the snapshot the server broadcasts here, so without this the status beside the selector
      // keeps answering for the backend just left — switching away from a dead Claude Code to a working
      // OpenCode would leave the bar still saying the project cannot run. Nothing about that is visible
      // by inspection, which is why it has a test of its own.
      onBackendChanged();
    });
  }

  function act(): void {
    void run(async () => {
      await (model.control.kind === 'stop' ? softStopAutopilot() : startAutopilot());
      onChanged();
    });
  }

  // The emergency stop. Asks first, with a dialog that names what dies — including the part people do
  // not expect, that the chat and manual runs stop working too until the project is restarted.
  function kill(): void {
    void confirm(killProjectRequest()).then((ok) => {
      if (!ok) return;
      void run(async () => {
        await killAutopilot('You stopped everything from the auto-pilot bar.');
        onChanged();
      });
    });
  }

  return (
    <div className={`ap-bar ap-bar-${model.tone}`} data-testid="ap-bar">
      <div className="ap-bar-row">
        <Transport control={model.control} onAct={act} />

        {/* Beside the transport, because it IS transport — the most destructive kind. Quiet until you
            hover it: a permanently red bar teaches people to stop reading the bar. */}
        {/* `default`, and NOT `danger` — but not `ghost` either. Two separate arguments, and the first
            one was previously used to settle the second. (a) Not `danger`: a control that is permanently
            red is one people stop reading, and this bar's whole job is to be read; it turns dangerous on
            hover, which `.ap-kill` still owns — a colour, which a caller may override, and not a
            geometry, which it may not. (b) Not `ghost`: the dashed border reads as EXPLANATORY, and an
            emergency stop is the most actionable control on the board. It looked like a footnote. */}
        <Button
          className="ap-kill"
          disabled={model.emergency.disabled || busy !== null}
          title={model.emergency.title}
          data-testid="ap-kill"
          onClick={kill}
        >
          <span aria-hidden="true">✕</span> Emergency stop
        </Button>

        <ToneDot tone={model.tone} />
        <span className="ap-status" data-testid="ap-status">
          {model.status}
        </span>

        {/* WHICH AGENT, and whether that agent can run. The two belong together and neither is useful
            alone: a provider name with no state does not say the run will start, and a state with no
            provider does not say what it is a state OF — which was the position before this, with
            auto-pilot silently taking the copilot's setting and reporting readiness for it under no
            name at all. */}
        <span className="ap-agent" data-testid="ap-agent">
          <BackendPicker
            value={backend}
            disabled={switching !== null}
            label="Which agent auto-pilot runs"
            titleFor={(b) =>
              `Run agents on ${b.label}. Saved as this project's default, so the copilot and manual runs use it too.`
            }
            onChange={chooseBackend}
          />
          <AgentChip agent={agent} />
        </span>

        {model.expandable && (
          // `ghost`, and this is the call the owner left open. A disclosure toggle EXPLAINS: it reveals
          // the bar's own detail and changes nothing in the project — same category as "How it works",
          // which shows prose where this shows numbers. Both are dashed; everything on this row that
          // acts on the run is solid.
          <Button
            variant="ghost"
            className="ap-inline"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            data-testid="ap-expand"
          >
            {open ? '▾' : '▸'} {open ? 'Hide' : 'Details'}
          </Button>
        )}
        {/* THE ghost, and the one the owner ruled on: a help affordance explains, which is what the
            dashed border says. */}
        <Button
          variant="ghost"
          className="ap-inline"
          onClick={() => setHelpOpen(true)}
          title="How auto-pilot works"
          data-testid="ap-help-btn"
        >
          ? How it works
        </Button>
        {/* Acts: it takes you to a surface where caps and columns are changed. Navigation is not
            explanation, so it is solid. */}
        <Button
          className="ap-inline"
          onClick={onSettings}
          title="Caps, the columns that mean finished, and where a blocked card goes"
          data-testid="ap-settings-link"
        >
          Settings
        </Button>

        {/*
          LAST IN THE ROW, deliberately. It is the one blocker a person CLEARS rather than fixes, so it
          is the one control that vanishes the moment it is used — and anything after it would jump
          leftwards as it went. Nothing is after it.

          It used to live inside this bar's drawer, behind a disclosure arrow, while Settings offered a
          Start button and no way to clear the block at all. A user was told to read the commands in
          Project Control, did, was refused again, and could not find the way out — because the way out
          was on a surface they had no reason to open.

          No confirm dialog: the words on the button ARE the assertion, and a second "are you sure?" over
          the top of them is the kind of prompt people learn to click through without reading.
        */}
        {model.reviewGates && (
          <Button
            className="ap-review-gates"
            data-testid="ap-review-gates"
            title="These files hold commands this server runs outside the sandbox, as you. Read them in Project Control first."
            onClick={() => {
              void acknowledgeGates().then(() => {
                setReviewed((n) => n + 1);
                onChanged();
              });
            }}
          >
            I have read the gate commands
          </Button>
        )}
      </div>

      {/* One banner for both actions. They cannot be in flight together — each disables its own
          control — and a refused backend write is as much "the server said no" as a refused start. */}
      {(error ?? switchError) && (
        <div className="ap-bar-error" data-testid="ap-bar-error">
          {error ?? switchError}
        </div>
      )}

      {/*
        WHY IT STOPPED, in full and wrapping. Its own block rather than the status line, which is a row:
        one line, ellipsised. These sentences name the branch that could not be created and quote git's
        own output underneath, so truncating them removes exactly the part worth reading — a user hit
        that twice and got the text out of the DOM by hand the second time.
      */}
      {model.detail && (
        <div className="ap-bar-detail" data-testid="ap-bar-detail">
          {model.detail}
        </div>
      )}

      {/*
        AND THE WAY BACK, beside the sentence that explains the stop.
        `stalled` is "work remains and nothing it can do would move it", and a spent bootstrap is one way to
        get there: the calculator's three derivation attempts were consumed by an OpenCode server that could
        not be reached, and the stop then blamed the README. Cards carry this control beside their own attempt
        counts; the derivation has no card, so this is the only place it can live.
        Only on `stalled`, deliberately: on `complete` there is nothing wrong to undo, and while `running` an
        unfinished run would land as an attempt of its own moments later — which is why the server refuses it
        too rather than only the button.
      */}
      <div className="ap-bar-remedy" data-testid="ap-bar-remedy">
        <ForgiveDerivation reason={state?.reason} onForgiven={onChanged} />
      </div>

      {open && (
        <div className="ap-drawer" data-testid="ap-drawer">
          <div className="ap-drawer-col">
            <div className="ap-drawer-head">Working on</div>
            {model.doing.length === 0 ? (
              <div className="vb-empty">Nothing is running.</div>
            ) : (
              <ul className="ap-work">
                {model.doing.map((w) => (
                  <li key={w.run}>
                    <strong>{w.label}</strong> · {w.skill}
                    {w.waiting && <span className="ap-waiting"> waiting for a slot</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="ap-drawer-col">
            <div className="ap-drawer-head">Stopping it from starting</div>
            {model.missing.length === 0 ? (
              <div className="vb-empty">Nothing — it is ready to run.</div>
            ) : (
              <ul className="blockers">
                {model.missing.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {helpOpen && <AutopilotHelp onClose={() => setHelpOpen(false)} />}
      {dialog}
    </div>
  );
}
