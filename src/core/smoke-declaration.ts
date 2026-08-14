// DECLARING THE SMOKE COMMAND, ruling 67 — the fix for the deadlock ruling 66 created.
//
// Ruling 66 made every project carry a smoke-harness feature whose card says the command "is declared as
// `smoke:` in foundation/TESTING.md". No agent can do that. `PUT /api/control/foundation/:name` is
// `assist`-only by decision 3, and `protectedPaths` mounts the foundation read-only inside the box — so the
// card asked for a write the machine forbids. A real run proved it: the implement agent built a working
// `npm run smoke`, reported that it could not declare it, and three reviews in a row correctly sent the card
// back for the one thing it was structurally unable to do. The loop then stopped on the review bound.
//
// WHY THIS IS NOT DECISION 3 REOPENED. That decision refuses an autonomous run the power to amend the
// documents it is judged against, because a run that can edit `gates:` can lower the bar until its own work
// passes. The smoke command is the opposite direction: it ADDS a check that must fail when the product cannot
// be run, and the project cannot be reported finished without it. Refusing it does not protect the bar — it
// was the thing preventing the bar from existing.
//
// AND IT GRANTS NO EXECUTION THE AGENT LACKED. The objection to an agent-chosen command string is that
// exec/commands.ts runs it through `/bin/sh` as the server's own user. But the gate commands already run
// agent-written test files the same way — `npm test` executes whatever the run put in `test/`. The door to
// host execution is open by design, through the contents rather than the string, so a validated one-line
// string adds nothing to it. What this module refuses is the thing that would be genuinely new: any reach
// beyond the single `smoke:` key.
//
// THE VALIDATION IS THE POINT. This is a narrow write, not a foundation editor: one key, validated here,
// with the prose and every other key left exactly as they were. `smokeIsAGate` in
// core/lifecycle/stop-sentences.ts still stands
// as the refusal at the end of the project — this check merely moves the same rule to the moment of the
// write, where it can be explained to the agent that can still fix it, instead of surfacing hours later as a
// project that will not close.

// A ceiling rather than a guess at what a command looks like. The shell has no length limit worth encoding,
// so this exists only to stop a runaway generation writing a novel into a YAML scalar.
const MAX_COMMAND = 500;

export type SmokeRefusal = string;

// Refuses with the sentence the agent is shown, or returns the command to write. The sentences name what to
// do next rather than what was wrong: an agent reading "that is one of the gates" still has to be told that
// the smoke command must start the product from outside, or it will simply try the next gate.
export function checkSmokeCommand(
  command: unknown,
  gates: readonly string[],
): { ok: true; command: string } | { ok: false; reason: SmokeRefusal } {
  if (typeof command !== 'string') {
    return {
      ok: false,
      reason: 'Expected `command` to be a string: the shell command that runs the smoke test.',
    };
  }
  const trimmed = command.trim();
  if (!trimmed) {
    return { ok: false, reason: 'The smoke command cannot be empty.' };
  }
  // One line, because the declaration is a scalar that a person reads in TESTING.md and the server hands
  // straight to `/bin/sh`. A script belongs in the repository, with this command starting it.
  if (/[\r\n]/.test(trimmed)) {
    return {
      ok: false,
      reason:
        'The smoke command must be a single line. Put the script in the repository and declare the command that runs it.',
    };
  }
  if (trimmed.length > MAX_COMMAND) {
    return {
      ok: false,
      reason: `The smoke command must be at most ${MAX_COMMAND} characters. Put the script in the repository and declare the command that runs it.`,
    };
  }
  if (gates.includes(trimmed)) {
    return {
      ok: false,
      reason: `\`${trimmed}\` is one of this project's gate commands, and a gate and a smoke command that are the same command are one check rather than two. The gates are written alongside the code they judge, so they can pass over a product that has no way to be run at all. Declare a command that starts the product the way the README describes starting it, and uses it from outside.`,
    };
  }
  return { ok: true, command: trimmed };
}
