import { endpointsFor } from '../../auth/auth.js';
import type { Scope } from '../../auth/credentials.js';

// THE ONLY PART OF THE PROMPT THAT REACHES `auth.ts`, and it is in its own module so that coupling is
// visible rather than buried in a 600-line assembler. Everything an agent is TOLD about its authority is
// generated here from the scope table, so a drift between this file and that table is a run that has been
// promised endpoints it cannot call — or denied ones it can.
//
// `allows()` still fails closed on every request, so a drift is not privilege escalation. It is worse to
// diagnose: the agent reads the 403 as a broken tool and falls back to writing card files by hand, which is
// the failure mode the endpoint list exists to prevent. `test/run-prompt.test.ts` asserts the assembled
// prompt's catalogue against the table in both directions for exactly that reason.

// The board is changed through the API, not by writing card files. Stated as the mechanism rather
// than as a preference: a column is a folder, so a file written to the wrong one does not fail — it
// creates a folder no column maps to, and the card inside it is invisible to the board while still
// holding its id. The endpoint refuses that; a file write cannot.
//
// THE LIST ITSELF IS GENERATED from auth.ts's scope table (`endpointsFor`). It used to be typed out
// here, again for the judge below, and a third time in the VIBEBOARD.md that scaffold.ts seeds — so
// granting a scope a new row told no agent anything, and every wording fix had to be made three
// times. The seeded document no longer lists endpoints at all; it points at whatever the credential
// section says, which is this. The confinement line is generated too: it is enforced server-side either way, but an agent
// that does not know about it reads a 403 as a broken tool and falls back to editing files.
export function credentialSection(apiBase: string, token: string, scope: Scope, cardId?: string): string {
  const endpoints = endpointsFor(scope, cardId);
  return [
    `Your credential: \`${token}\`. Send it as \`Authorization: Bearer <credential>\` to \`${apiBase}\`.`,
    'It stops working the moment this run ends, and it is yours alone — do not put it in a card, a',
    'report or a file.',
    '',
    ...(endpoints.length === 0
      ? [
          // A scope with no rows is not a mistake to paper over: `work` narrowed to nothing is a
          // legitimate future state, and inventing capabilities for it would be worse than silence.
          'It grants you nothing beyond reading the files, which are yours to read.',
        ]
      : [
          'Use these rather than writing files under `.vibeboard/`. A card is a file in a column folder,',
          'so a file written to a column that does not exist does not fail — it creates one, and the card',
          'in it vanishes from the board while keeping its id. These endpoints refuse that:',
          '',
          ...endpoints,
        ]),
    '',
    // The board read is named once: where there are endpoints, the list above already carries it.
    endpoints.length === 0
      ? 'Reading is unrestricted: `GET /api/state` is the whole board, and the files are yours to read.'
      : 'Reading is unrestricted, and the files are yours to read.',
    'Anything not listed above is not yours — say so in your report instead. A `403` means exactly that:',
    'it is a limit, not a broken tool, and writing the file by hand instead is refused too.',
  ].join('\n');
}

// A JUDGING run's credential, which grants it nothing on the board.
//
// It exists because the alternative was worse in both directions. Handing a judge the section above gave
// it two contradictory REQUIRED contracts — "edit this card with PATCH" immediately followed by "do not
// edit the card" — and saying nothing at all leaves an agent to find a live token in its prompt with no
// explanation, which is an agent that will experiment with it.
//
// The scope itself is `work`, because a review is dispatched down the ordinary run path like any other card
// run. What stops it changing the board is that it is handed no board-changing endpoints at all.
export function judgeCredentialSection(apiBase: string, token: string): string {
  return [
    `Your credential: \`${token}\`. Send it as \`Authorization: Bearer <credential>\` to \`${apiBase}\`.`,
    'It stops working the moment this run ends, and it is yours alone — do not put it in a card, a',
    'report or a file.',
    '',
    'It is for READING. `GET /api/state` is the whole board, and the files are yours to read. Nothing',
    'about the board is yours to change: not this card, not another one, not where any of them sit.',
    'Your report is the verdict, and it is the only thing this run produces.',
  ].join('\n');
}

// The chat copilot's, when a person has authorised it. Same generator, different scope — which is the
// point of generating it: the copilot's authority is a row in the same table as everything else.
export function assistCredentialSection(apiBase: string, token: string): string {
  return [
    `Your credential: \`${token}\`. Send it as \`Authorization: Bearer <credential>\` to \`${apiBase}\`.`,
    'It belongs to THIS conversation and dies with it. Never put it in a card, a file, or a message.',
    '',
    'You are authorised to change the board and the foundation documents through these endpoints. Use',
    'them rather than writing files under `.vibeboard/` — every one of those paths is denied to you by',
    'the OS, so a write there fails rather than doing something surprising:',
    '',
    ...endpointsFor('assist'),
  ].join('\n');
}

// FIX BOARD'S, and the same generator again (decision 88): what a repair may call is `repair`'s rows in the one
// table, so this cannot promise an endpoint the scope does not hold. Its lifetime is said differently because it
// IS different — the credential ends when this turn does, not when the conversation does.
export function repairCredentialSection(apiBase: string, token: string): string {
  return [
    `Your credential: \`${token}\`. Send it as \`Authorization: Bearer <credential>\` to \`${apiBase}\`.`,
    'It is for THIS repair and stops working the moment you finish answering. Never put it in a card, a',
    'file, or a message.',
    '',
    'You are authorised to repair the board through these endpoints and nothing else. Use them rather than',
    'writing files under `.vibeboard/` — every one of those paths is denied to you by the OS, so a write there',
    'fails rather than doing something surprising:',
    '',
    ...endpointsFor('repair'),
  ].join('\n');
}
