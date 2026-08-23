import { useEffect, useRef } from 'react';
import { Button } from '../../atoms/Button';
import { Modal } from '../shared/Modal';

// How auto-pilot works, in the app rather than in a design document nobody reading the header has open.
//
// Written to answer the four questions a person actually has in front of a play button: what will it do,
// what stops it, what it will not do without me, and where the money goes. Every claim here is a
// behaviour enforced in code — the phase table in core/phases.ts, the verification gate, the caps
// compared between dispatches — because instructions that describe an intention rather than the build
// are how a control that changes nothing gets trusted.
export function AutopilotHelp({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <Modal
      label="How auto-pilot works"
      title="How auto-pilot works"
      className="ap-help"
      bodyClassName="ap-help-body"
      onClose={onClose}
      head={
        <Button size="md" ref={closeRef} onClick={onClose}>
          Close
        </Button>
      }
    >
      <h3>The loop</h3>
      <p>
        Auto-pilot walks your three boards on its own. Each pass it works out{' '}
        <strong>where the project is</strong> from the board itself — which feature is open, which story under
        it, which task — and looks up the one thing to do next. It does that thing, checks the result, and
        moves the card on <em>only if the check passes</em>. Then it does it again. It stops by itself when
        there is nothing left it can legitimately do.
      </p>
      <p>
        The sequence of phases is <strong>fixed</strong> and is not a setting: a lifecycle a person can edit
        is one that can be edited into something that never finishes. What you can change is in Settings — the
        caps, which columns mean finished, and where a blocked card goes.
      </p>

      <h3>Nothing advances on its own word</h3>
      <p>
        An agent finishing is not an agent succeeding. Work is <strong>verified</strong> three ways:{' '}
        <code>gates</code> runs the project's own commands (tests, lint, a build), <code>smoke</code> runs the
        one command that proves the thing works end to end, and <code>review</code> asks a second agent only
        what a command's exit code cannot express — and only once the gates have passed.
      </p>
      <p>
        The card moves on the <em>verdict</em>, never on the run's own report of itself. A run that claims
        success and fails its gates leaves its card exactly where it was, with the failing command and its
        output recorded on the run.
      </p>

      <h3>Parents finish by a checkup, not for free</h3>
      <p>
        A story or a feature becomes eligible to close once every card beneath it is settled, but it does not
        close for free: it earns one final <strong>checkup</strong> run that looks at what was actually built.
        A checkup may create the work it finds missing once, and after that it may only close or say why it
        cannot.
      </p>

      <h3>What stops it</h3>
      <ul>
        <li>
          <strong>complete</strong> — the only stop that means the work is done.
        </li>
        <li>
          <strong>capped</strong> / <strong>exhausted</strong> — it hit your dispatch cap or your dollar
          budget. Tidy, and not the same as finished.
        </li>
        <li>
          <strong>stalled</strong> — every remaining card is blocked, and the reason names which ones.
        </li>
        <li>
          <strong>no-op</strong> — there was no live card to work on in the first place.
        </li>
        <li>
          <strong>stopped</strong> / <strong>killed</strong> — you did. Stop is reversible and lets runs in
          flight finish; the emergency stop, beside it on this bar, kills every agent in the project and halts
          it.
        </li>
      </ul>
      <p>
        Every card also has an <strong>attempt cap</strong>: after that many runs of one skill it is blocked
        rather than retried forever. A run you stopped yourself does not count against it.
      </p>

      <h3>What it will not do</h3>
      <p>
        Agents cannot dispatch other agents — that is what keeps the counters honest. They cannot move their
        own card into a done column, write their own verdict, or read the whole project's run history. They
        work through the same endpoints you do, with a credential scoped to one card, and the OS sandbox stops
        them writing cards, config, skills or instructions directly.
      </p>

      <h3>Before it can start</h3>
      <p>
        The strip tells you what is missing and refuses with a sentence rather than a greyed-out button.
        Typically: a README with something in it, the foundation documents, at least one gate command, a smoke
        command, and a skill on disk for every phase that dispatches one.
      </p>

      <h3>Where to watch it</h3>
      <p>
        <strong>Details</strong> on the strip shows what is running now. The <strong>Execution</strong> tab
        has every run, what it cost and what it changed; the <strong>Project Log</strong> is the narrative,
        one line per dispatch and per checkup. A <strong>checkup</strong> runs when a story or a feature has
        nothing unfinished left under it, and it is what closes the card.
      </p>
    </Modal>
  );
}
