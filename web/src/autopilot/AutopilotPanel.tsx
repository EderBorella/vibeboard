import { useState } from 'react';
import {
  type AutopilotState,
  acknowledgeGates,
  killAutopilot,
  type Readiness,
  softStopAutopilot,
  startAutopilot,
} from '../api';
import { killProjectRequest } from '../confirm/requests';
import { useConfirm } from '../confirm/useConfirm';
import { errorText } from '../errors';
import { useAccounting } from '../runs/useAccounting';
import { type AutopilotConfig, BLOCKED_BOARDS, BOARD_LABELS, type ProjectConfig } from '../shared';
import { Button } from '../atoms/Button';
import { Control } from '../atoms/Control';
import { Text } from '../atoms/Text';
import { Field } from '../ui/Field';
import { useReadiness } from './useReadiness';

// The lifecycle as it will actually be executed, plus what is stopping it.
//
// A routing table nobody can see is the same failure as a gate nobody has watched fail: it looks
// like a decision and behaves like an assumption. Every route is listed, in order, with the skill
// that runs and the column a passing card moves to.
//
// The caps ARE editable now, because they are now enforced: the budget and the iteration cap are
// compared in backend code between dispatches (src/core/dispatch-gate.ts). Until that existed they
// were deliberately read-only — a budget dial wired to nothing is what AutoGPT and AgentGPT both
// shipped, and a control that changes no behaviour tells you the opposite of the truth.
//
// Changes are reported UP rather than saved here, so the modal keeps one Save button and the server's
// refusal — which may be about the routing table, not the number you touched — surfaces in one place.

// The caps, and what each one is for. A table rather than five near-identical blocks of JSX: the only
// things that differ are the bounds and the sentence.
const CAPS = [
  {
    key: 'budgetUsd' as const,
    label: 'Budget (USD)',
    min: 0,
    step: 1,
    hint: 'Auto-pilot stops when the project’s runs have cost this much. Zero means no dollar budget — for a subscription or a local model the reported figure is not what you are billed.',
  },
  {
    key: 'maxIterations' as const,
    label: 'Max dispatches',
    min: 1,
    step: 10,
    hint: 'The cap on how many times auto-pilot may dispatch in one run. This is what bounds a project with no dollar budget.',
  },
  {
    key: 'attemptCap' as const,
    label: 'Attempts per card',
    min: 1,
    step: 1,
    hint: 'How many runs of one skill a card gets before it is blocked. A run you stopped does not count against it.',
  },
];

export function AutopilotPanel({
  config,
  onCaps,
  autopilot,
  onAutopilotChanged,
}: {
  config: ProjectConfig;
  // Called with the whole set of edited caps on every change. The modal merges them into the config's
  // autopilot block and saves once, with everything else.
  onCaps?: (caps: Partial<AutopilotConfig>) => void;
  // The one copy of the state, owned by App. See the note on SettingsModal's props for why the panel
  // must not open its own.
  autopilot: AutopilotState | null;
  onAutopilotChanged: () => void;
}) {
  const hasLifecycle = config.autopilot !== undefined;
  // The SAME hook the transport strip uses. Two fetches of one question are two answers that can
  // disagree, and the point of the readiness endpoint is that everything reads one list.
  const { readiness, failed } = useReadiness(autopilot?.state ?? 'none', hasLifecycle);

  // Seeded from config and edited locally; the modal owns the save. Declared before the early return
  // below, because a hook after a conditional return is a different bug.
  const [caps, setCaps] = useState<Partial<AutopilotConfig>>({});
  const accounting = useAccounting(config);
  // Clamped here, not merely validated on the server. An emptied number box gives `Number('') === NaN`,
  // which `JSON.stringify` puts on the wire as `null`, and `min={0}` on the input does not stop a typed
  // `-5` — so the user cleared a box and got a 400 about column routing. A box that cannot express an
  // invalid value needs no refusal.
  const edit = (key: keyof AutopilotConfig, value: number, min: number, max?: number): void => {
    const clamped = Number.isFinite(value) ? Math.max(min, value) : min;
    const next = { ...caps, [key]: max === undefined ? clamped : Math.min(max, clamped) };
    setCaps(next);
    onCaps?.(next);
  };

  const ap = config.autopilot;
  if (!ap) {
    return (
      <>
        <div className="settings-section">Auto-pilot</div>
        <Text role="hint">
          This project has no autopilot block in its config, so there is no lifecycle to run. Projects created
          before auto-pilot are upgraded in one pass once the work lands — until then this is an honest
          refusal rather than a half-upgrade.
        </Text>
      </>
    );
  }

  return (
    <>
      <div className="settings-section">Auto-pilot</div>
      <Text role="hint">
        The lifecycle is fixed (ruling 52): auto-pilot derives where a project is from the board and looks up
        what to do next. It is not a setting, so there is no table here to edit — only the caps below, the
        columns that mean finished, and where a blocked card goes.
      </Text>
      <div className="settings-section">Caps</div>
      <Text role="hint">
        {/* S10: the number that will actually stop this project, in words. A dollar dial beside a
            budget that can never trip tells the reader the opposite of the truth. */}
        {accounting?.cap?.why ?? 'Whichever of these is reached first will stop the run.'}
      </Text>
      {CAPS.map((cap) => (
        <Field label={cap.label} hint={cap.hint} key={cap.key}>
          <Control
            type="number"
            min={cap.min}
            step={cap.step}
            value={caps[cap.key] ?? ap[cap.key]}
            onChange={(e) => edit(cap.key, Number(e.target.value), cap.min)}
          />
        </Field>
      ))}
      <Field
        label="Run timeout (minutes)"
        hint="One run is abandoned after this long and recorded as failed, which burns an attempt — a card that hangs every time must not retry for ever."
      >
        {/* Minutes, because 1800000 in a box is unreadable. The enforceable per-run bound is
            wall-clock: a dollar ceiling per run is not implementable, since usage is only known once
            the run has finished spending it. */}
        <Control
          type="number"
          min={1}
          step={5}
          value={Math.round((caps.runTimeoutMs ?? ap.runTimeoutMs) / 60_000)}
          onChange={(e) => edit('runTimeoutMs', Number(e.target.value) * 60_000, 60_000)}
        />
      </Field>
      <Text role="hint">
        Finished at:{' '}
        {Object.entries(ap.terminal)
          .map(([b, c]) => `${b} ${c.join('/')}`)
          .join(', ')}{' '}
        · blocked cards go to {ap.blockedColumn} on{' '}
        {`${BLOCKED_BOARDS.map((b) => BOARD_LABELS[b]).join(' and ')}.`}
      </Text>

      <StartControl state={autopilot} readiness={readiness} refresh={onAutopilotChanged} />
      <StopControls state={autopilot} refresh={onAutopilotChanged} />

      {/* The `marginTop: '0.6rem'` inline style that stood here is GONE rather than moved: 9.6px is off
          the space scale, no rule in the tree wrote it, and the panel is a flex column with a gap of its
          own. A new class to carry it would be a class for one margin. */}
      <Text role="hint">Before auto-pilot can start:</Text>
      {readiness === null && !failed && <Text role="hint">Checking…</Text>}
      {failed && <Text role="hint">Could not read this project’s readiness.</Text>}
      {readiness?.ok && <div className="ready-ok">Everything auto-pilot needs is in place.</div>}
      {readiness && !readiness.ok && (
        <ul className="blockers">
          {readiness.blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
    </>
  );
}

// Press start, and see why not when it refuses.
//
// C2's minimal control: an endpoint nobody can press is a feature that does not exist. What is deliberately
// NOT here is C4's pre-flight and approval screen — this is the button, not the ceremony around it.
//
// Every refusal the server can give is rendered verbatim, because each one names the way forward: a missing
// gate command, an unwritten foundation document, no sandbox, a halted project. The button is disabled for
// the two states where starting is meaningless, and enabled otherwise — including when the project is not
// ready, deliberately: a disabled button with no explanation is the dead end this design refuses to ship,
// and pressing it is how you find out what is missing.
function StartControl({
  state,
  readiness,
  refresh,
}: {
  state: AutopilotState | null;
  readiness: Readiness | null;
  refresh: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const running = state?.state === 'running';
  const halted = state?.state === 'halted';

  return (
    <>
      <div className="settings-section">Running</div>
      <Text role="hint">
        Auto-pilot walks the board on its own: it picks a card, runs its phase's skill, checks the work, and
        moves the card only if the check passes. It stops on its own when there is nothing left it can do.
      </Text>
      <div className="ap-controls">
        <Button
          variant="primary"
          size="md"
          // Running means it is already going; halted needs a person to restart it first. Not-ready is NOT a
          // reason to disable: the refusal is how you learn what is missing.
          disabled={running || halted || starting}
          onClick={() => {
            setError(null);
            setStarting(true);
            void startAutopilot()
              .then(() => refresh())
              .catch((e: unknown) => setError(errorText(e)))
              .finally(() => setStarting(false));
          }}
        >
          {starting ? 'Starting…' : 'Start auto-pilot'}
        </Button>
        {running && (
          <Text role="hint" testId="ap-progress">
            Running — {state?.iteration ?? 0} dispatch{(state?.iteration ?? 0) === 1 ? '' : 'es'} so far
          </Text>
        )}
        {halted && <Text role="hint">Halted. Restart it from the overlay first.</Text>}
      </div>
      {/* The blockers again, next to the button, because the list further up the panel is easy to scroll
          past — and this is the moment somebody wants to know. */}
      {!running && readiness && !readiness.ok && (
        <Text role="hint">
          Auto-pilot cannot start yet: {readiness.blockers.length} thing
          {readiness.blockers.length === 1 ? '' : 's'} to fix, listed above.
        </Text>
      )}
      {/*
        The one blocker this panel can CLEAR rather than describe. Offered here as well as on the bar,
        because this panel has its own Start button — and listing a blocker beside a button that cannot
        act on it is exactly how a user got stuck: told to read the commands in Project Control, refused
        again on their return, with the only working control on a surface behind this modal.

        Not a duplicate of the bar's for the sake of it: wherever Start is, the way past this has to be.
      */}
      {(readiness?.unreviewedGates?.length ?? 0) > 0 && (
        <div className="ap-controls">
          <Button
            size="md"
            data-testid="ap-panel-review-gates"
            onClick={() => {
              setError(null);
              void acknowledgeGates()
                .then(() => refresh())
                .catch((e: unknown) => setError(errorText(e)));
            }}
          >
            I have read the gate commands
          </Button>
        </div>
      )}
      {error && <div className="settings-error">{error}</div>}
    </>
  );
}

// Soft stop and emergency stop. The way BACK from a halt is on the overlay rather than here, because a
// halted project is not one you can reach Settings through.
//
// Two buttons rather than one with a modifier: one of these is reversible and the other kills work in
// flight, and that difference should not live in a checkbox.
function StopControls({ state, refresh }: { state: AutopilotState | null; refresh: () => void }) {
  const { confirm, dialog } = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const running = state?.state === 'running';
  const halted = state?.state === 'halted';

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setError(null);
    try {
      await fn();
      refresh();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <>
      <div className="settings-section">Stopping</div>
      <Text role="hint">
        A soft stop leaves the app alone: chat, manual runs and the board carry on, and only dispatching
        stops. An emergency stop kills every agent in this project and halts it until you restart it.
      </Text>
      <div className="ap-controls">
        <Button
          size="md"
          // Nothing to stop when it is not running, and refused outright while halted.
          disabled={!running}
          onClick={() => void act(() => softStopAutopilot('You stopped it from Settings.'))}
        >
          Soft stop
        </Button>
        <Button
          variant="danger"
          size="md"
          disabled={halted}
          onClick={() => {
            void confirm(killProjectRequest()).then((ok) => {
              if (ok) void act(() => killAutopilot('You stopped everything from Settings.'));
            });
          }}
        >
          Emergency stop
        </Button>
      </div>
      {error && <div className="settings-error">{error}</div>}
      {dialog}
    </>
  );
}
