import { readGates, readSmokeCommand } from '../core/foundation.js';
import {
  type CommandResult,
  commandFailed,
  commandVerification,
  failedVerification,
  type Verification,
} from '../core/verify.js';
import { runCommand } from './commands.js';

// The two modes that verify by RUNNING something: `gates` (every command CODE-QUALITY.md declares) and
// `smoke` (the one TESTING.md declares).
//
// Composed from three parts each tested on its own: the readers, which already distinguish absent from
// unparseable from empty; `runCommand`, which never throws and always ends; and the pure builders, which
// decide the verdict. What lives HERE is the fail-closed wiring — a project that cannot say what its
// gates are does not pass them, and nothing is run on its behalf.
//
// Gates run in DECLARED ORDER and stop at the first failure. The later ones usually fail because an
// earlier one did, so running them spends minutes producing evidence that points at the wrong place.

export type RunOne = (command: string, opts: { cwd: string; timeoutMs?: number }) => Promise<CommandResult>;

interface Opts {
  timeoutMs?: number;
  // Injected the way `GitMeasure` is, so the composition can be tested without spawning anything — and
  // so the spawning is tested once, where it belongs (commands.ts).
  run?: RunOne;
}

export async function verifyGates(root: string, at: string, opts: Opts = {}): Promise<Verification> {
  const declared = await readGates(root);
  // The reader's reason, verbatim: it already says which file and which of the four ways it was wrong,
  // and rewording it here would give one problem two sentences.
  if (!declared.ok) return failedVerification('gates', at, declared.reason);
  const run = opts.run ?? runCommand;
  const results: CommandResult[] = [];
  for (const gate of declared.gates) {
    const result = await run(gate.command, {
      cwd: root,
      ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
    });
    results.push(result);
    if (commandFailed(result)) break;
  }
  return commandVerification('gates', at, results);
}

export async function verifySmoke(root: string, at: string, opts: Opts = {}): Promise<Verification> {
  const declared = await readSmokeCommand(root);
  if (!declared.ok) return failedVerification('smoke', at, declared.reason);
  const run = opts.run ?? runCommand;
  const result = await run(declared.command, {
    cwd: root,
    ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
  });
  return commandVerification('smoke', at, [result]);
}
