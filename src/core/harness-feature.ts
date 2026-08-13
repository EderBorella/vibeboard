// THE SMOKE-HARNESS FEATURE, ruling 66's remedy: every project gets one, and the LOOP creates it at the
// bootstrap's exit (src/service/act.ts) rather than `derive-features` being told to.
//
// NOT A PROMPT INSTRUCTION, and that is the whole point. The run that produced this ruling has direct evidence
// of `derive-features` not following its instructions reliably — ten features where five were derived, two
// cards with one title, a report claiming two where the board had three — and a feature that is mandatory but
// depends on an agent remembering is one that will sometimes be missing. The loop already writes to the board
// at that exit (it stamps `setup: true`, decision 44), so this is the same kind of act.
//
// IT SORTS LAST, AND THAT IS CORRECT rather than a compromise: you cannot write a smoke test for a product that
// does not exist yet. Created after the derivation, it takes the next order in `features/backlog` by
// construction — which is load-bearing, because built early the harness would verify nothing.
//
// THE BODY IS CANNED BECAUSE THE REQUIREMENT IS GENERIC, and it names NO TECHNOLOGY. What "used the way the
// README describes" means — a browser driver for a page, a text extractor for a document, a spawned process for
// a command-line tool — is `break-down`'s decision later, from the README and foundation/STACK.md. A technology
// chosen here would be a technology chosen before anyone read the project.
//
// WHAT IT CANNOT DO, stated so no comment overclaims it: this feature's OWN tasks are judged by the same weak
// gate as everything else, so it closes the hole for every other feature and cannot close it for itself. You
// cannot bootstrap verification from nothing. The refusal in core/tick.ts is what stops the weakest version of
// that — a harness that declared the gate command as the smoke command and changed nothing.

export const HARNESS_FEATURE = {
  title: 'The product can be run the way the README describes',
  body: `This project has a smoke test that exercises the product from OUTSIDE — started the
way the README describes starting it, used the way the README describes using it —
and its command is declared as \`smoke:\` in foundation/TESTING.md.

**That command must not be one of the gate commands** foundation/CODE-QUALITY.md
declares. A gate and a smoke command that are the same command are one check, not
two: the gates are written alongside the code they judge, so they can pass over a
product that has no way to be run at all. This one has to fail when the product
cannot be used. Auto-pilot will not report this project finished while the two are
the same command.

How the smoke test does that is for the break-down of this card to decide, from the
README and foundation/STACK.md. What it must not be is a second run of the tests
that already gate every card.

This feature is built LAST, after the product exists. There is nothing to smoke
test before then.
`,
} as const;
