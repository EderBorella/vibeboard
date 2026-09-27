import { describe, expect, it } from 'vitest';
import type { AutopilotConfig } from '../src/core/autopilot.js';
import { coverageProblems, phaseSkillProblems } from '../src/core/autopilot-cover.js';
import { LIFECYCLE_SKILLS } from '../src/core/phases.js';
import type { ProjectConfig } from '../src/core/types.js';
import { defaultConfig } from '../src/store/project/config.js';

const fresh = (): ProjectConfig => defaultConfig('T');

// Narrowing helper: every fixture below has just been built by defaultConfig, so the block is there.
// A non-null assertion at each use site would be the same claim made twenty times.
function ap(config: ProjectConfig): AutopilotConfig {
  if (!config.autopilot) throw new Error('fixture has no autopilot block');
  return config.autopilot;
}

describe('lifecycle coverage', () => {
  it('passes a default project', () => {
    expect(coverageProblems(fresh())).toEqual([]);
  });

  it('refuses a terminal column that exists on no board', () => {
    const config = fresh();
    ap(config).terminal.product = ['done', 'finished'];
    expect(coverageProblems(config)).toContain(
      'terminal names "finished" for product, which is not a column on that board — a mistyped terminal column silently makes nothing terminal.',
    );
  });

  it('refuses a board with no terminal column, since nothing on it could ever finish', () => {
    const config = fresh();
    ap(config).terminal.features = [];
    expect(coverageProblems(config)).toContain(
      'terminal names no column for features, so no card on that board could ever finish.',
    );
  });

  it('refuses a blocked column engineering does not have', () => {
    const config = fresh();
    ap(config).blockedColumn = 'stuck';
    const problems = coverageProblems(config);
    expect(problems).toContain('blockedColumn is "stuck", which is not a column on the engineering board.');
  });

  // CHANGE 3 OF DECISION 45's REPEAL, and the only one of the four that is a change to NOTHING: this refusal
  // STAYS. Its own test rather than the second half of the one above, because it now guards a specific
  // shortcut — making `complete` reachable by listing `blocked` under terminal.engineering. That one line
  // would do it, and it would also make a blocked card count as `complete`'s own positive evidence, which is
  // the false success the other three changes were careful not to open.
  it('refuses a config listing blocked under terminal.engineering', () => {
    const config = fresh();
    ap(config).terminal.engineering = ['done', 'blocked'];
    // The exact string rather than a match: it carried the "also routed" half of this refusal too, and
    // that half retired with the routing table.
    expect(coverageProblems(config)).toContain(
      'blockedColumn "blocked" is listed as terminal for engineering, which would report blocked work as done.',
    );
  });

  // AND THE SAME ONE LINE UNDER PRODUCT, which decision 45's 2026-08-13 correction made reachable: a
  // blocked story listed as terminal is `complete`'s own positive evidence, so a project whose last story
  // nobody could break down would report itself finished over it. The board is NAMED, or a reader who
  // wrote the line under product is sent to look at engineering.
  it('refuses a config listing blocked under terminal.product', () => {
    const config = fresh();
    ap(config).terminal.product = ['done', 'blocked'];
    expect(coverageProblems(config)).toContain(
      'blockedColumn "blocked" is listed as terminal for product, which would report blocked work as done.',
    );
  });

  // Features has no blocked column, so `blocked` under terminal.features is not this refusal's business —
  // it is a mistyped terminal column, which `checkTerminal` already names, and reporting both would be one
  // problem told twice with two different remedies.
  it('says nothing about a blocked column on a board that has none', () => {
    const config = fresh();
    ap(config).terminal.features = ['done', 'blocked'];
    expect(coverageProblems(config).join(' ')).not.toContain('would report blocked work as done');
  });

  // The unknown-verify-mode half of this case went with `verify:`, which was a per-route field. Nothing
  // configures how work is judged any more — the phase table does (ruling 52).
  it('refuses a non-positive cap', () => {
    const config = fresh();
    ap(config).attemptCap = 0;
    expect(coverageProblems(config)).toContain('attemptCap must be a positive whole number; it is 0.');
  });

  // Zero is a real budget: for a subscription-backed or local model the figure is zero or not what
  // you are billed, and then maxIterations is the governing cap.
  it('allows a zero budget but not a negative one', () => {
    const zero = fresh();
    ap(zero).budgetUsd = 0;
    expect(coverageProblems(zero)).toEqual([]);
    const negative = fresh();
    ap(negative).budgetUsd = -1;
    expect(coverageProblems(negative)).toContain('budgetUsd must be zero or more; it is -1.');
  });

  // Absence fails closed: a project from before this slice is refused with a reason, not admitted.
  it('refuses a project with no autopilot block at all', () => {
    const config = fresh();
    delete config.autopilot;
    expect(coverageProblems(config)).toEqual([
      'This project has no autopilot block in config.yaml, so there is no lifecycle to run.',
    ]);
  });
});

// A phase whose skill does not exist is the unreachable-column failure one level in: the phase is chosen,
// the dispatch 404s, and nothing can ever advance the card. Asked of the PHASE TABLE (ruling 52), which is
// what stops the panel and the loop disagreeing about the lifecycle — and it is now the ONLY structural
// check left here, the routing table's six having retired with the table itself.
describe('the skill every phase needs', () => {
  it('blocks when a project has no skill for a phase', () => {
    const problems = phaseSkillProblems(['implement', 'fix']);
    expect(problems.join(' ')).toContain('review-story');
    expect(problems.join(' ')).toContain('checkup-feature');
    // Every refusal names the action that fixes it: `seedSkills` writes only into a project with NO
    // skills folder, so a project that lost one cannot get it back by reopening.
    expect(problems.join(' ')).toContain('Skills tab');
  });

  it('passes a project that has every one of them', () => {
    expect(phaseSkillProblems([...LIFECYCLE_SKILLS])).toEqual([]);
  });

  // DECISION 100: a project is asked only for the skills its own mode walks.
  it('asks a Mini project for Mini’s two, and a standard one for everything else', () => {
    const standard = LIFECYCLE_SKILLS.filter((s) => s !== 'build-project' && s !== 'review-project');
    expect(phaseSkillProblems(standard, 'standard')).toEqual([]);
    expect(phaseSkillProblems(['build-project', 'review-project'], 'mini')).toEqual([]);
    expect(phaseSkillProblems(['build-project'], 'mini').join(' ')).toContain('review-project');
    expect(phaseSkillProblems(standard, 'mini').join(' ')).toContain('build-project');
  });

  it('says nothing about a skill no phase names', () => {
    // `execute` is a seeded skill the machine never dispatches. Its absence blocks nothing, or every
    // project that deleted a skill it does not use would be refused.
    const said = phaseSkillProblems([...LIFECYCLE_SKILLS]).join(' ');
    expect(said).not.toContain('execute');
    expect(phaseSkillProblems([...LIFECYCLE_SKILLS, 'execute'])).toEqual([]);
  });

  // One sentence per missing skill, naming every phase that wanted it: `break-down` is two phases, and
  // two sentences about one absent file would be one problem reported twice.
  it('names the phases that wanted a missing skill, once', () => {
    const problems = phaseSkillProblems(LIFECYCLE_SKILLS.filter((s) => s !== 'break-down'));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('feature-breakdown');
    expect(problems[0]).toContain('story-breakdown');
  });
});

// Findings from the slice A review. Each of these returned [] before the fix, and each of them ends
// in the same place the whole validator exists to prevent: a run that reports success, or one that
// cannot finish and does not say why.
describe('coverage — holes found in review', () => {
  it('reports a malformed block instead of throwing on it', () => {
    const config = fresh();
    config.autopilot = { maxIterations: 10 } as unknown as AutopilotConfig;
    const problems = coverageProblems(config);
    expect(problems).toContain('autopilot.terminal must name the terminal columns of each board.');
    // Shape problems come back ALONE: the checks below them all index into the block.
    expect(problems.every((p) => p.startsWith('autopilot.'))).toBe(true);
  });

  it('names the pre-per-board terminal shape specifically, since a flat list looks right', () => {
    const config = fresh();
    ap(config).terminal = ['done'] as unknown as AutopilotConfig['terminal'];
    expect(coverageProblems(config)).toContain(
      'autopilot.terminal is a flat list; it must name the terminal columns per board.',
    );
  });

  it('refuses a fractional cap, which no integer counter ever equals', () => {
    const config = fresh();
    ap(config).attemptCap = 0.5;
    ap(config).maxIterations = 2.5;
    const problems = coverageProblems(config);
    expect(problems).toContain('attemptCap must be a positive whole number; it is 0.5.');
    expect(problems).toContain('maxIterations must be a positive whole number; it is 2.5.');
  });
});

// The shape checks run first and alone, because every later check indexes into the block. Each of them
// needs its own case: removing the `blockedColumn` one changed no test at all, which was found by
// planting while the tick was made to depend on this function.
describe('a block that is not the shape it claims', () => {
  const malformed = (patch: Record<string, unknown>): string[] => {
    const config = fresh();
    Object.assign(ap(config), patch);
    return coverageProblems(config);
  };

  it('refuses a blocked column that is not even a string', () => {
    expect(malformed({ blockedColumn: 42 })).toEqual(['autopilot.blockedColumn must be a column slug.']);
  });

  // A MISTYPED MODE MUST NOT READ AS `standard`. `ensureAutopilotKeys` backfills an ABSENT key only, so a
  // hand-edited `mode: expres` reaches the tick — and defaulting there would run the whole project on the
  // lifecycle the person was trying to leave, silently and at roughly three times the cost.
  it('refuses a lifecycle mode that is not one of the three', () => {
    expect(malformed({ mode: 'expres' })).toEqual([
      'autopilot.mode must be one of standard or express or mini; it is "expres".',
    ]);
    // Absent counts too: a block hand-written without the key is not a project on `standard`, it is a
    // project whose lifecycle nobody has said. `ensureAutopilotKeys` fills it before this is ever asked on
    // a saved config, and this is what holds when something skips that.
    const gone = fresh();
    delete (ap(gone) as { mode?: unknown }).mode;
    expect(coverageProblems(gone)).toEqual([
      'autopilot.mode must be one of standard or express or mini; it is undefined.',
    ]);
  });

  // ABSENT IS THE ORDINARY STATE — the whole board — so only a present value is checked. An empty string is
  // refused with the non-strings: it would confine the loop to a card whose id is `''`, which no board has,
  // and the refusal it produced downstream would name nothing.
  it('refuses a focus that is not a card id, and accepts its absence', () => {
    expect(malformed({ focus: 42 })).toEqual([
      'autopilot.focus must be the id of a feature card, or absent for the whole board; it is 42.',
    ]);
    expect(malformed({ focus: '  ' })).toEqual([
      'autopilot.focus must be the id of a feature card, or absent for the whole board; it is "  ".',
    ]);
    expect(malformed({ focus: 'F-002' })).toEqual([]);
    expect(malformed({})).toEqual([]);
  });

  it('accepts express, so the check is not simply refusing everything', () => {
    expect(malformed({ mode: 'express' })).toEqual([]);
  });

  it('refuses a terminal block that is absent, or the flat list it used to be', () => {
    const gone = fresh();
    delete (ap(gone) as { terminal?: unknown }).terminal;
    expect(coverageProblems(gone)).toEqual([
      'autopilot.terminal must name the terminal columns of each board.',
    ]);
    expect(malformed({ terminal: ['done'] })).toEqual([
      'autopilot.terminal is a flat list; it must name the terminal columns per board.',
    ]);
  });

  // Alone, and that is the claim: a malformed shape returns before anything indexes into the block, so a
  // reader is not handed "terminal is not a list" next to a dozen consequences of it.
  it('reports the shape and nothing else, even when the rest is also wrong', () => {
    expect(malformed({ terminal: 'done', attemptCap: 0 })).toEqual([
      'autopilot.terminal must name the terminal columns of each board.',
    ]);
  });
});

// The four cases that pinned `skillProblems`'s route reading and its `critic` special case are gone with
// the function: the question is no longer which skill a ROUTE names but which one a PHASE names, and the
// phase table has no verifier to look up — a review is a phase of its own. See the describe above.
