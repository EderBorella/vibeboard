import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { skillRel } from '../src/core/layout.js';
import { defaultConfig } from '../src/store/project/config.js';
import { SEED_SKILLS, seedSkills } from '../src/store/project/seed-skills.js';
import { readSkills } from '../src/store/project/skill-catalogue.js';
import { tempDir } from './helpers.js';

const config = defaultConfig('T');

describe('seedSkills', () => {
  it('writes every seeded skill into an empty project', async () => {
    const root = await tempDir();
    expect(await seedSkills(root)).toBe(true);
    const { skills, invalid } = await readSkills(root, config);
    expect(invalid).toEqual([]);
    expect(skills.map((s) => s.slug)).toEqual([...SEED_SKILLS.map((s) => s.slug)].sort());
  });

  it('every seeded skill is valid against a default config', async () => {
    // The seeds ship in the product: an invalid one would be invisible in the rail with no clue
    // why. This is the test that would catch a typo in a seed's frontmatter.
    const root = await tempDir();
    await seedSkills(root);
    const { skills } = await readSkills(root, config);
    expect(skills).toHaveLength(SEED_SKILLS.length);
    for (const s of skills) {
      expect(s.name).not.toBe('');
      expect(s.description).not.toBe('');
      expect(s.prompt.length).toBeGreaterThan(20);
      // No column scoping: a column slug must exist in that project's config, and a project may
      // have renamed its columns. Boards are fixed by BOARDS, so board scoping is always valid.
      expect(s.columns).toEqual([]);
    }
  });

  it('leaves an existing skills folder alone, so a deleted skill stays deleted', async () => {
    const root = await tempDir();
    await seedSkills(root);
    await rm(join(root, skillRel(SEED_SKILLS[0].slug)), { recursive: true });

    expect(await seedSkills(root)).toBe(false);
    const { skills } = await readSkills(root, config);
    expect(skills.map((s) => s.slug)).not.toContain(SEED_SKILLS[0].slug);
  });

  it('leaves an adopted repo that already has its own skills untouched', async () => {
    // A real skill, not a bare folder: the fixture used to be an empty directory and read the
    // result out of `invalid`, which only worked while an empty folder counted as an invalid skill.
    // What this test is about is that seeding neither overwrites what is already there nor adds its
    // own beside it.
    const root = await tempDir();
    await mkdir(join(root, skillRel('their-skill')), { recursive: true });
    const theirs = '---\nname: their-skill\ndescription: what they wrote\n---\nTheir prompt.\n';
    await writeFile(join(root, skillRel('their-skill', 'SKILL.md')), theirs, 'utf8');

    expect(await seedSkills(root)).toBe(false);
    const { skills, invalid } = await readSkills(root, config);
    expect(skills.map((s) => s.slug)).toEqual(['their-skill']);
    expect(invalid).toEqual([]);
    expect(skills[0].prompt).toBe('Their prompt.');
  });

  it('does not edit a seed already on disk', async () => {
    const root = await tempDir();
    await seedSkills(root);
    const path = join(root, skillRel(SEED_SKILLS[0].slug, 'SKILL.md'));
    const mine = '---\nname: Mine\ndescription: my own\n---\nMy prompt.\n';
    await writeFile(path, mine, 'utf8');
    await seedSkills(root);
    expect(await readFile(path, 'utf8')).toBe(mine);
  });
});

describe('the two entry points', () => {
  it('scaffolding a project seeds its skills', async () => {
    const { scaffoldProject } = await import('../src/store/project/scaffold.js');
    const root = await tempDir();
    await scaffoldProject(root, { name: 'S', mode: 'greenfield', today: '2026-07-26' });
    const { skills } = await readSkills(root, config);
    expect(skills.map((s) => s.slug)).toEqual([...SEED_SKILLS.map((s) => s.slug)].sort());
  });

  it('the open-time upgrade path seeds skills into a project that predates them', async () => {
    // ensureControlFiles runs on every project open. A project scaffolded before skills existed
    // has none, and would otherwise show an empty rail forever.
    const { ensureControlFiles } = await import('../src/store/project/control.js');
    const root = await tempDir();
    await ensureControlFiles(root);
    const { skills } = await readSkills(root, config);
    expect(skills.map((s) => s.slug)).toEqual([...SEED_SKILLS.map((s) => s.slug)].sort());
  });
});

// The phase table names skills by slug, and the seeds are where those skills come from. Nothing else ties
// the two together: rename a folder and the phase dispatches nothing, so it silently never runs — under
// auto-pilot, where nobody is watching it not happen. Asked of PHASES rather than of a routing table
// (ruling 52), which is also what `phaseSkillProblems` asks a live project.
describe('the phase skills the phase table names', () => {
  it('scopes each phase skill to the board its phase sits on', async () => {
    const root = await tempDir();
    await seedSkills(root);
    const { skills } = await readSkills(root, config);
    const boardsOf = (slug: string): string[] => skills.find((s) => s.slug === slug)?.boards ?? ['MISSING'];
    expect(boardsOf('derive-features')).toEqual(['features']);
    // THE STORY'S, since the work moved up to it (decision 83). `implement` is still seeded — implementing
    // one task by hand is a thing a person does — but no phase names it, so it is scoped like `execute`.
    expect(boardsOf('implement-story')).toEqual(['product']);
    expect(boardsOf('implement')).toEqual(['engineering']);
    expect(boardsOf('break-down')).toEqual(['features', 'product']);
    // The lifecycle's own, each scoped to the boards its phases sit on. `fix` is ONE phase since decision 83
    // retired the task's — `phaseForRun('fix', 'engineering')` is undefined, pinned in test/phases.test.ts —
    // and it still answers on BOTH boards, because a person fixing one task by hand is a thing the skill is
    // seeded for (the reason is on `FIX_PHASES` in src/core/bounds.ts). The story's judgement is about a
    // story, a feature checkup about a feature.
    expect(boardsOf('fix')).toEqual(['engineering', 'product']);
    expect(boardsOf('review-story')).toEqual(['product']);
    expect(boardsOf('checkup-feature')).toEqual(['features']);
  });

  // What keeps a proof of concept from becoming a product. Both halves have to be in the prompt, or
  // the rule exists only in the design document.
  it('tells break-down to size by acceptance criterion and to file what will not fit', () => {
    const content = SEED_SKILLS.find((s) => s.slug === 'break-down')?.content ?? '';
    expect(content).toContain('One acceptance criterion per card');
    expect(content).toContain('POST /api/suggestions');
  });

  // DECISION 85. The KEY has to be named, because a break-down that does not send it writes a card no
  // machine can answer — and the BOUND has to be named with it, or an agent reads "send a command" and
  // sends one the project never declared. Exact bytes, because this is a prompt and the wording IS the
  // behaviour: `toContain('satisfiedBy')` would pass over a sentence telling it to invent a command.
  it('tells break-down to name a declared gate when that gate IS the card', () => {
    const content = SEED_SKILLS.find((s) => s.slug === 'break-down')?.content ?? '';
    expect(content).toContain(
      "**If a card's one criterion IS one of the gate commands** this project declares —\nthey are quoted in full in this prompt — then say so: send `satisfiedBy` on the\ncreate, carrying that command copied exactly.",
    );
    expect(content).toContain(
      'A string that is not one of the declared gates is\nignored, so this is never a way to get something else run.',
    );
  });

  // SUPERSEDED BY RULING 65, and recorded rather than quietly dropped. This asserted
  // `PUT /api/cards/:board/:id/links` — the obligation to attach each new card to this one — and the endpoint
  // now writes that link itself, from the credential it is already holding. Leaving the instruction would be
  // two writers for one fact, and the agent's is the one that can send an INCOMPLETE list: the payload replaces
  // a card's links wholesale, so a break-down that had created two children and named one would orphan the
  // other. The exact bytes of what replaced it are pinned below.
  it('no longer tells break-down to write the link, which the endpoint now writes', () => {
    const content = SEED_SKILLS.find((s) => s.slug === 'break-down')?.content ?? '';
    expect(content).not.toContain('PUT /api/cards/:board/:id/links');
    expect(content).toContain(
      '- The board a card may go on, the column it enters, its `group` and the card it\n  hangs off are all decided by the endpoint rather than by you.',
    );
  });

  // RULING 58's refusal falsified this sentence: a second card with the same title in the same column is
  // refused at the endpoint, so a second set of children is NOT a mistake nothing else notices. What replaced
  // it is the cost, which is true whoever notices.
  it('does not tell break-down that nothing notices a second set of children', () => {
    const content = SEED_SKILLS.find((s) => s.slug === 'break-down')?.content ?? '';
    expect(content).not.toContain('nothing else\nnotices');
    expect(content).toContain(
      'A card that already has children does not need breaking down again, and a\nsecond set of them costs a break-down, an implement, the gates and a review each\nfor work that is already on the board.',
    );
  });

  // SUPERSEDED, and recorded rather than quietly rewritten. This asserted `features/todo` and "never in the
  // column this card is in", which was decision 37: `features/backlog` dispatched `derive-features`, so a
  // feature created there was sent straight back through the phase that made it. Under this machine a column
  // dispatches nothing — the phase comes from the position — so `backlog` is where the queue belongs, and the
  // self-loop is closed by the machine rather than by an instruction (decision 43's own table).
  it('tells derive-features where the feature queue lives, and which feature is the scaffolding', () => {
    const content = SEED_SKILLS.find((s) => s.slug === 'derive-features')?.content ?? '';
    expect(content).toContain('features/backlog');
    expect(content).not.toContain('features/todo');
  });

  // WEAKENED DELIBERATELY, because the instruction stopped being the mechanism. The endpoint stamps `group`
  // now (server/boards/cards-routes.ts), so "this card's own group if it has one, and otherwise this card's id" is a
  // rule the agent no longer carries out — and asserting it would pin an instruction that cannot be wrong.
  // What survives is that the body NAMES the field, so an agent reading a value it did not set is not
  // surprised by it and does not try to correct it.
  it('tells break-down that the vertical’s group is stamped for it', () => {
    const content = SEED_SKILLS.find((s) => s.slug === 'break-down')?.content ?? '';
    expect(content).toContain('`group`');
  });

  // THE DIRECTION of the spine, not merely its vocabulary. These were dotAll `.+` regexes, which a review
  // showed pass just as well when the two levels are stated backwards — "a user story breaks into features" —
  // because both words appear somewhere in the document. The exact sentence, then: this is a prompt, so the
  // wording IS the behaviour.
  it('tells break-down what the level below is called, and in which direction', () => {
    const content = SEED_SKILLS.find((s) => s.slug === 'break-down')?.content ?? '';
    expect(content).toContain(
      'A **feature** breaks into **user stories** on the\nproduct board; a **user story** breaks into **tasks** on engineering.',
    );
  });

  it('tells implement to file what it finds rather than widen the card', () => {
    const content = SEED_SKILLS.find((s) => s.slug === 'implement')?.content ?? '';
    expect(content).toContain('POST /api/suggestions');
    expect(content).toContain('CODE-QUALITY.md');
  });

  // RULING 66, in the two skills that write foundation/TESTING.md. The deterministic half is in the tick, and
  // this is the half that stops the collision being written in the first place — an OBLIGATION about what the
  // run must produce, never a claim about which commands are declared right now (ruling 64): that is the
  // prompt's to state, and the project it happens to be running on decides it.
  // Pinned per skill and as exact bytes, because the two obligations are about different things and the
  // difference is the behaviour: break-down writes the CARD that will ask for the command, implement writes the
  // FILE. A shared substring would pass over either one drifting into the other's job.
  //
  // AND THE EXACT BYTES ARE WHAT HOLDS RULING 64 here, rather than a second test grepping for a forbidden
  // phrase. Both sentences open with a CONDITION — "If a card you create declares…", "If this card asks you
  // to…" — so neither claims what either document declares right now, which is the prompt's to state and this
  // project's to decide. A negative grep was tried and was weak: restating the obligation as the fact "the
  // smoke command in foundation/TESTING.md is not one of the gate commands" slips past every phrase worth
  // banning, and fails this pin immediately. Verified by planting exactly that.
  it('tells both skills that declare the smoke command that it is not a gate command', () => {
    expect(SEED_SKILLS.find((s) => s.slug === 'break-down')?.content).toContain(
      "**If a card you create declares the project's `smoke:` command**, say on the card\nthat the way to declare it is `POST /api/foundation/smoke` with `{ command }`.",
    );
    expect(SEED_SKILLS.find((s) => s.slug === 'implement')?.content).toContain(
      "**If this card asks you to declare the project's `smoke:` command**, declare it\nwith `POST /api/foundation/smoke` and a body of `{ command }`.",
    );
    // RULING 67, and the reason this pin is worth its exactness. Both sentences used to send the agent to
    // foundation/TESTING.md, which decision 3 refuses to every autonomous scope and `protectedPaths` mounts
    // read-only — so the instruction named a file no run could write, and the mandatory harness feature
    // deadlocked on it for three reviews before the bound stopped auto-pilot. If either sentence drifts back
    // to naming the file as the thing to edit, this fails.
    for (const slug of ['break-down', 'implement']) {
      const content = SEED_SKILLS.find((s) => s.slug === slug)?.content ?? '';
      expect(content, slug).toContain('POST /api/foundation/smoke');
      expect(content, slug).toContain('read-only');
    }
    // And the reason, which both carry: a reader told only "not that one" has no way to choose the next one.
    for (const slug of ['break-down', 'implement']) {
      expect(SEED_SKILLS.find((s) => s.slug === slug)?.content, slug).toContain(
        'are one check, not two: gates are written',
      );
    }
  });

  it('keeps the manual skills a person already had', () => {
    expect(SEED_SKILLS.map((s) => s.slug)).toEqual(
      expect.arrayContaining(['execute', 'research', 'summarise']),
    );
  });
});

// THE LIFECYCLE'S OWN SEVEN. Every one of these is prose, and for a prompt the wording IS the behaviour — so
// what is asserted here is the exact sentences the design turns on, not that a body exists.
describe('the lifecycle skills', () => {
  const body = (slug: string): string => SEED_SKILLS.find((s) => s.slug === slug)?.content ?? '';

  it('seeds every lifecycle skill the phase table names', async () => {
    // From the TABLE, not from a list here: a phase whose skill nothing seeds is a phase that can never run,
    // and under auto-pilot nobody is watching it not happen.
    const { LIFECYCLE_SKILLS } = await import('../src/core/phases.js');
    const slugs = SEED_SKILLS.map((s) => s.slug);
    for (const skill of LIFECYCLE_SKILLS) expect(slugs, skill).toContain(skill);
  });

  // DECISION 45, VERBATIM, and this is the boundary that makes the attempt cap unescapable. Without it a
  // checkup can create work to get past a blocked task — and that story gets three fix attempts of its own,
  // then another checkup, then another story, through the one authority these runs have.
  it('tells the story judgement and the feature checkup the blocked-task rule, verbatim', () => {
    for (const slug of ['review-story', 'checkup-feature']) {
      expect(body(slug), slug).toContain('A blocked task is **settled**, not outstanding');
      expect(body(slug), slug).toContain('Do not create work to get past a blocked task');
      expect(body(slug), slug).toContain(
        'it has already had every attempt it is allowed, and it is waiting for a person',
      );
    }
  });

  it('tells the feature checkup the same rule one level up', () => {
    // A story whose task is blocked is itself settled. Without this, a feature checkup attacks the story
    // instead of the task, which is the same escape one level out.
    expect(body('checkup-feature')).toContain('A story carrying a blocked task is settled too');
  });

  it('tells every creating skill to read the board first', () => {
    // Decision 43: creating work is not idempotent, so a creating phase must look first. And one card per
    // call, never a shell loop the agent cannot verify.
    for (const slug of ['derive-features', 'break-down', 'review-story', 'checkup-feature']) {
      expect(body(slug), slug).toMatch(/read the board first/i);
      expect(body(slug), slug).toContain('one card per call');
    }
  });

  it('tells derive-features that the first feature is the scaffolding', () => {
    expect(body('derive-features')).toContain('scaffolding');
    expect(body('derive-features')).toContain('CODE-QUALITY.md');
    // And it must NOT ask the agent to flag it: the loop stamps that at the bootstrap's exit, from the board,
    // and `CreateCardInput` has no such field for an agent to set even if it tried.
    expect(body('derive-features')).not.toContain('setup: true');
  });

  // BESIDE the exact-bytes assertion above, never instead of it. That one catches a REWORDED sentence; this
  // one catches a REORDERING that leaves both sentences intact — "a user story breaks into features" reads
  // perfectly and is the wrong way up.
  //
  // THE PROSE, not the frontmatter: `boards: [features, product]` contains the word "features", so an indexOf
  // over the whole file matched the frontmatter and half this assertion was vacuous.
  it('names the spine in the right direction, as well as in the right words', () => {
    const prose = body('break-down').split('---')[2] ?? '';
    expect(prose.indexOf('user stories')).toBeGreaterThan(-1);
    expect(prose.indexOf('user stories')).toBeLessThan(prose.indexOf('tasks'));
    expect(prose.indexOf('**feature**')).toBeLessThan(prose.indexOf('user stories'));
  });

  // DECISION 83, AND THE THREE THINGS THE UNIT CHANGE TURNS ON. The wording IS the behaviour for a prompt,
  // and each of these is a rule that has no other home: the run is told which tasks are its own by where
  // they stand, ALL of them are required, and the gates are still the bar it must leave green.
  it('tells implement-story which tasks are its own, and that all of them are required', () => {
    // The column the loop stamps the group into, named as the thing to read — that stamp is the only way a
    // run can be told, so a body that named no column would leave the ceiling unenforceable.
    expect(body('implement-story')).toContain('`engineering/in-progress`');
    expect(body('implement-story')).toContain('every one of them\nis required');
    // AND THE ONES IT MUST LEAVE ALONE, which is what makes a story past the ceiling two runs rather than
    // one bundled one.
    expect(body('implement-story')).toContain("A task still in `backlog` is a\nlater run's");
    // EVERY CRITERION, said as an obligation on the report: the tasks arrive as file paths, so "read them
    // all" has to be stated or the run answers the story's own criterion and stops.
    expect(body('implement-story')).toContain('naming each task by id with its acceptance criterion');
  });

  it('keeps the gate bar on the story’s implement, where the per-task one had it', () => {
    expect(body('implement-story')).toContain('foundation/CODE-QUALITY.md are the bar');
    expect(body('implement-story')).toContain('a run that leaves them failing has not\ndelivered');
    // AND NAMES WHAT RUNNING THEM ONCE COSTS. Failure locality is the price of the merge, and a run that
    // does not know that cannot keep track of which task broke the suite.
    expect(body('implement-story')).toContain('not say which\ntask broke it');
  });

  it('tells implement-story to file what it finds rather than widen the story', () => {
    expect(body('implement-story')).toContain('POST /api/suggestions');
    expect(body('implement-story')).toMatch(/nothing more/i);
  });

  it('tells fix to address the findings and nothing else', () => {
    // A fix that widens the card is a fix nobody asked for, and it spends the same budget as the one that
    // was asked for.
    expect(body('fix')).toContain('POST /api/suggestions');
    expect(body('fix')).toMatch(/do not widen/i);
  });

  it('tells the story judgement to change nothing and to answer with a verdict', () => {
    // "Change nothing" rather than "do not edit": a judge that fixes what it is judging is grading its own
    // work, and the credential grants it nothing on the board either way.
    expect(body('review-story')).toContain('Change nothing');
    expect(body('review-story')).toContain('verdict');
  });

  // THE FRAME DECISION 80 REMOVED. The retired `review` skill opened "Judge ONE run against the card", and
  // that sentence is why it could not fail: a reviewer scoped to one task's turn is never shown two tasks at
  // once, so it cannot see that the third undid the first. 77 of 77 returned `done`.
  it('does not tell the story judgement it is judging one run, and asks whether the tasks compose', () => {
    expect(body('review-story')).not.toMatch(/one run/i);
    expect(body('review-story')).toContain('do the tasks COMPOSE?');
  });

  it('tells the story judgement and the feature checkup they do not move their own card', () => {
    // The loop stamps the column (decision 38). A judge that moved its card would be a card advancing on
    // the say-so of the run judging it.
    for (const slug of ['review-story', 'checkup-feature']) {
      expect(body(slug), slug).toMatch(/do not move/i);
    }
  });

  it('tells the feature checkup the smoke result is evidence rather than a verdict', () => {
    // RULING 55. A feature whose smoke command fails is exactly what a person needs told about, so the run
    // decides what it means rather than being blocked by it.
    expect(body('checkup-feature')).toMatch(/evidence/i);
  });

  // RULING 64: a skill file states OBLIGATIONS, never facts the prompt owns. What is true right now — which
  // gates ran, what the reviewer said, which children are blocked — is the loop's to compute and the prompt's
  // to state, and a body that repeats it contradicts the prompt wrapped around it.
  it('does not tell the story judgement auto-pilot ran the gates, which is false for a hand dispatch', () => {
    // The prompt says nobody ran them when nobody did. The obligation — read what it says — survives; the
    // claim about what happened does not.
    // BOTH PATTERNS, and the first is the one that predates the body it guards. Migrating a negative
    // assertion in the same change as its subject buys nothing: whatever the new wording is, the new
    // pattern was chosen to miss it. The retired `review` skill's own sentence stays asserted here.
    expect(body('review-story')).not.toMatch(/auto-pilot runs the gates/i);
    expect(body('review-story')).not.toMatch(/auto-pilot ran every command/i);
    expect(body('review-story')).toContain('This prompt tells you what the gates did');
    expect(body('review-story')).toContain('Do not assume');
  });

  it('does not tell the feature checkup to close its own card while also telling it not to move one', () => {
    // Two required contracts, one of which cannot be carried out: the loop stamps the column, and a checkup
    // has no authority to close anything. What it owes is a report saying the work is finished.
    expect(body('checkup-feature')).not.toMatch(/close it\b/i);
    expect(body('checkup-feature')).toContain('**say so in your report**');
    // And the obligation it replaced is still there, so this did not delete the rule with the wording.
    expect(body('checkup-feature')).toMatch(/is finished/i);
    expect(body('checkup-feature')).not.toMatch(/you may close the feature/i);
  });

  // THE SAME RULE, ONE SHAPE DOWN. The story's judgement has a `verdict` where the checkup had a report, so
  // "say so in your report" is not its contract — answering `done` is. It must still not be told to close.
  it('does not tell the story judgement to close its own card', () => {
    expect(body('review-story')).not.toMatch(/close it\b/i);
    expect(body('review-story')).toContain('Answer with a verdict');
  });

  // THE BRIEF IS A CEILING, and this is the first real run's other finding. The test project's README says
  // "a single Node script with no dependencies beyond the standard library, and it has tests"; `break-down`
  // turned its scaffolding feature into FIVE user stories, two of them a build-and-deployment pipeline and a
  // set of git hooks. Nothing malfunctioned, which is the whole problem: the machine delivers every story it
  // is given, at a break-down, an implement, the gates and a review apiece.
  //
  // EXACT BYTES, in both halves. A substring match on "ceiling" would pass just as well on a sentence that
  // said the opposite, and for a prompt the wording IS the behaviour. What the real verification is — a
  // by-hand run against a real model — no test here can be.
  it('tells break-down that the brief is the ceiling, verbatim', () => {
    expect(body('break-down')).toContain(
      "**The brief is a ceiling, not a starting point.** The card below and the project's\nREADME are the bound: read the README, and split what those two ask for and\nnothing else.",
    );
    // The other half of the same rule: over-scope is a SUGGESTION, so nothing is blocked and nothing is lost
    // (decision 11). Without this the ceiling would read as "drop it on the floor".
    expect(body('break-down')).toContain(
      'Work neither of them asks for is a **suggestion**, not a card — file\nit with `POST /api/suggestions`',
    );
  });

  // THE VERIFIER HALF, and the more durable one: the checkups are the only runs that see a whole feature at
  // once, so they are where a story nobody asked for can actually be noticed. Identical bytes in both, because
  // the rule is one rule.
  it('gives both judging points the job of noticing over-scope, in the same words', () => {
    for (const slug of ['review-story', 'checkup-feature']) {
      expect(body(slug), slug).toContain(
        "**The brief is a ceiling, and this phase is where over-scope is noticed.** Read the\nproject's README: it and the card below are the bound on what belongs under this\ncard.",
      );
      // AND THE BOUNDARY WITH IT (decisions 45 and 47). Noticing over-scope is a thing to REPORT: a checkup
      // creates for what was MISSED, and a licence to act on what it disagrees with would be a licence to
      // archive a card on a model's opinion.
      expect(body(slug), slug).toContain(
        'over-scope, and **naming it in\nyour report is the whole of what you do about it** — your one creating round is for\nwhat was MISSED, never for work nobody asked for.',
      );
    }
  });

  // RULING 65, and the checkups are the half of it that is a FINDING rather than a change: neither body has
  // ever mentioned linking, so a checkup agent following its instructions exactly created an orphan even before
  // the endpoint bug. The server writes the link now, so what these must not acquire is the obligation ruling 65
  // took off break-down — two writers for one fact, one of which can send an incomplete list.
  it('tells neither judging point to link what it creates, and asks each for a card per call', () => {
    for (const slug of ['review-story', 'checkup-feature']) {
      expect(body(slug), slug).not.toContain('/links');
      expect(body(slug), slug).toContain('one card per call');
    }
  });

  it('promises the feature checkup the blocked list it is actually rendered', () => {
    // `checkupSection` renders ONE flat list of everything blocked beneath the card, at any depth. The body
    // promised each story's blocked descendants per story, which is a fact the prompt does not carry — so the
    // run either invents the attribution or reports that it could not.
    expect(body('checkup-feature')).toContain('ONE list of everything blocked');
    expect(body('checkup-feature')).toContain('not broken down per story');
  });
});

// THE WIZARD'S TWO PROJECT RUNS. Card-less runs dispatched by setup, so nothing about a board or a
// column reaches them: what they are is their prompt and the one route it names. Asserted as sentences
// rather than as "a body exists", for the reason the lifecycle bodies are — a prompt's wording IS its
// behaviour, and these two are the only agents that speak before the person has seen anything.
describe("the wizard's project-run skills", () => {
  const body = (slug: string): string => SEED_SKILLS.find((s) => s.slug === slug)?.content ?? '';

  it('seeds both of them, valid against a default config', async () => {
    const root = await tempDir();
    await seedSkills(root);
    const { skills } = await readSkills(root, config);
    const slugs = skills.map((s) => s.slug);
    for (const slug of ['scan-project', 'suggest-stack']) expect(slugs, slug).toContain(slug);
  });

  // Their ONLY door. A skill that describes what to find and never says where to send it produces a run
  // whose findings die in its report, which is indistinguishable from a scan that found nothing.
  it('sends both of them to the prefill route and nowhere else on the wizard', () => {
    for (const slug of ['scan-project', 'suggest-stack']) {
      expect(body(slug), slug).toContain('PUT /api/wizard/prefill');
      // `PUT /api/wizard` is admin-only and would 403: a body that names it teaches the agent to
      // retry against a door that is shut by design. decision 77.
      expect(body(slug), slug).not.toContain('PUT /api/wizard`');
    }
  });

  // W7's spirit, and the whole reason a suggestion is safe to show: the person reads every field as
  // fact until they disprove it, so a plausible wrong guess costs more than the blank it filled.
  it('tells the scan that omitting beats inventing', () => {
    expect(body('scan-project')).toContain('Omitting beats inventing');
    expect(body('scan-project')).toContain('omit if you are guessing');
    expect(body('scan-project')).toContain('Do not build or run\nanything.');
  });

  // The brownfield half of W9: a stack proposal that replaces what a repository already uses is a
  // rewrite nobody asked for, arriving as a suggestion on setup's second screen.
  it('tells the stack suggestion that the stack already there wins', () => {
    expect(body('suggest-stack')).toContain('the stack that is already there\nwins unless it is unworkable');
    expect(body('suggest-stack')).toContain('boring and well-trodden beats novel');
    expect(body('suggest-stack')).toContain('a beginner can read');
  });
});

// THE THREE HAND-DISPATCH SKILLS the lifecycle never uses. Frozen as exact bytes, because "untouched" is a
// claim about this task and an assertion about a substring would not have held it.
const FROZEN: Record<string, string> = {
  execute: `---
name: Execute
description: Implement what the card describes
boards: [engineering]
---
Implement the card below.

Read any linked product card first: it carries the intent, while an engineering
card often carries only the mechanics. Work in small steps, and run the
project's own test and lint commands before you finish.

Do not change a card's id, and do not move a card between columns unless the
card itself asks you to.
`,
  research: `---
name: Research
description: Gather context and options without changing anything
---
Research the card below and report what you find.

Do NOT create, edit or delete any file except the report you are asked to write.
This is a reading task: explore the codebase, the linked cards and any attached
material, and weigh the options.

End with a recommendation and the reasoning behind it, so the next run can act
on it without repeating the search.
`,
  summarise: `---
name: Summarise
description: Condense the card and everything it links to
---
Summarise the card below together with every card it links to.

Say what the work is, what state it is in, and what is left. Keep it short
enough to read at a glance — this exists so someone returning to the card does
not have to read the whole chain.

Change nothing on disk except the report you are asked to write.
`,
};

describe('the skills the lifecycle does not use', () => {
  it('leaves the three hand-dispatch skills untouched', () => {
    for (const slug of ['execute', 'research', 'summarise']) {
      expect(SEED_SKILLS.find((s) => s.slug === slug)?.content, slug).toBe(FROZEN[slug]);
    }
  });
});
