import { CONFIG_DIR, RUNS_DIR } from './layout.js';

// WHICH FILES THE EXPLORER SHOULD SAY SOMETHING ABOUT BEFORE YOU SAVE.
//
// The tab can reach everything in the project on purpose — that is what an explorer is, and the path
// sandbox is what keeps it inside the project. But three kinds of file in there are not the user's
// content, and editing one by hand has consequences the tab cannot show:
//
//   - GIT INTERNALS. `.git/hooks` is code the HOST runs on the next commit, and `.git/config` can
//     repoint hooks somewhere writable through `core.hooksPath`. A box mounts both read-only for
//     exactly that reason (`PROTECTED_PATHS` in containers.ts); the explorer is the same escape by the
//     other door, with a person on the end of it rather than an agent.
//   - BOARD STATE. Everything under `.vibeboard/` that is not a run: the config, the auto-pilot state,
//     the boards. These are read by a machine that is possibly running right now, and a half-written
//     one is not a broken file, it is a lifecycle decision taken on nonsense.
//   - RUN SCRATCH. `.vibeboard/runs/` is the one place inside `.vibeboard/` an agent may write, and a
//     live run's report and transcript land there. Editing one mid-run races the process writing it.
//
// A WARNING AND NEVER A REFUSAL, which is why this answers a sentence rather than a boolean. Every one
// of these is a legitimate thing to do deliberately — fixing a corrupt config by hand is the reason the
// tab reaches them at all. What is not legitimate is doing it without being told.
//
// PURE, and in `core/` rather than beside the explorer, because both ends need the same answer: the
// tree marks a row with it and the save dialog quotes it, and two copies of a list like this drift.

export type PathSensitivity = 'git-internal' | 'board-state' | 'run-scratch';

export interface SensitivePath {
  kind: PathSensitivity;
  // One line, written for the person about to press Save. It names the consequence, not the category.
  why: string;
}

// Root-relative POSIX, the same shape `normaliseRel` produces — '' is the project root. A path is IN a
// directory when it equals it or sits under it; `startsWith` alone would match `.gitignore` for `.git`,
// which is an ordinary file the user edits all the time.
function within(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`);
}

export function sensitivity(path: string): SensitivePath | undefined {
  if (within(path, RUNS_DIR)) {
    return {
      kind: 'run-scratch',
      why: 'This is a run’s own scratch space. If a run is going, it is writing here — an edit can be overwritten a second later, or land in the middle of the report VibeBoard is about to read.',
    };
  }
  if (within(path, CONFIG_DIR)) {
    return {
      kind: 'board-state',
      why: 'This is board state, not content. VibeBoard and the auto-pilot loop read these files as they are; a wrong value here is a lifecycle decision taken on nonsense rather than a file that fails to open.',
    };
  }
  if (within(path, '.git')) {
    return {
      kind: 'git-internal',
      why: 'This is git’s own state. Files under .git/hooks are executed ON YOUR MACHINE by your next commit, and .git/config can point hooks at anything — which is why an agent’s container mounts both read-only.',
    };
  }
  return undefined;
}
