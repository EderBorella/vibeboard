import { describe, expect, it } from 'vitest';
import { fixedSandbox } from '../src/server/boxes/sandbox.js';
import { createCopilotTurns } from '../src/server/copilot/copilot-turns.js';
import type { AppCtx } from '../src/server/route-context.js';
import { assistCredentialSection } from '../src/server/runs/prompt/credential.js';
import { tempDir } from './helpers.js';

// THE TRANSCRIPT GETS THE PERSON'S WORDS; THE MODEL GETS THE CREDENTIAL TOO — and this file is the
// only thing that holds the first half.
//
// It is a security property and not a tidiness one. A chat file under `.vibeboard/chat/` is readable
// inside the project's box for as long as it exists, so a token recorded in one is readable by every
// agent that ever works that project — and it outlives the conversation that minted it, because the
// file does. The comment at the seam in copilot-turns.ts has said so since authority shipped; nothing
// asserted it.
//
// WHAT HELD IT UNTIL NOW WAS AN ACCIDENT OF TWO OTHER TESTS. `wizard-frame.test.ts` drives this same
// handler and checks the transcript, but its subject is the wizard's brief — its one authorised case
// is about the compact sentinel, and it asserts the transcript only to show that `/compact` was
// recorded. An ordinary authorised conversation — which is every authorised conversation there will
// ever be — was covered by nothing at all. Deleting `chats.recordUser(text)` and recording the
// model's copy instead passed the whole suite.
//
// THE REAL HANDLER AND THE REAL SECTION, on both sides. The fakes are at the edges the turn touches —
// no docker, no CLI, no chat store on disk — and never between `handleCopilotSend` and the thing
// being asserted. A fixture spelling out what a credential section looks like would be wrong in
// exactly the way the code was; `assistCredentialSection` is imported and asked.

interface Seam {
  send: (text: string, root: string) => Promise<void>;
  modelText: () => string;
  transcript: () => string[];
}

// `token` authorises the conversation, exactly as a person pressing Authorise does. Modelled on the
// seam in wizard-frame.test.ts, which drives the same handler for the other prefix.
function seam(token: string): Seam {
  const recorded: string[] = [];
  let sent = '';
  let settle: () => void = () => {};
  const ctx = {
    session: { root: undefined as string | undefined, config: undefined },
    copilot: {
      state: { running: false },
      send: async (opts: { text: string; onStart: () => void }) => {
        opts.onStart();
        sent = opts.text;
        settle();
      },
    },
    copilotAuthority: {
      forTurn: async () => ({ token }),
      endedIfChanged: () => {},
    },
    chats: {
      recordUser: async (text: string) => {
        recorded.push(text);
      },
      recordEvent: async () => {},
      recordError: () => {},
      flush: async () => {},
      currentId: async () => 'chat-1',
      chatList: async () => ({ chats: [] }),
      historyPayload: async () => ({ items: [] }),
    },
    autopilot: { current: async () => ({ state: 'idle' }) },
    sandbox: fixedSandbox({ ok: true, image: 'test-image' }),
    broadcast: () => {},
  } as unknown as AppCtx;

  const turns = createCopilotTurns(ctx);
  return {
    send: async (text, root) => {
      (ctx.session as { root?: string }).root = root;
      const done = new Promise<void>((resolve) => {
        settle = resolve;
      });
      turns.handleMessage(JSON.stringify({ type: 'copilot:send', text, mode: 'bypassPermissions' }));
      await done;
    },
    modelText: () => sent,
    transcript: () => recorded,
  };
}

const TOKEN = 'a-real-token';
const ASKED = 'please move E-001 to done';

describe('the credential at the copilot seam', () => {
  // NO WIZARD FILE ANYWHERE, which is what makes this the ordinary case: the other prefix composed at
  // this seam cannot be in play, so what reaches the model is the credential section and the person's
  // words and nothing else.
  it('reaches the model and never the transcript, in an ordinary authorised conversation', async () => {
    const root = await tempDir();
    const s = seam(TOKEN);

    await s.send(ASKED, root);

    // THE MODEL'S COPY, first — an assertion about what is absent from the transcript proves nothing
    // unless the thing was present to begin with. Asked of the real composer rather than described.
    const section = assistCredentialSection(`http://127.0.0.1:${process.env.VIBEBOARD_PORT ?? 4610}`, TOKEN);
    expect(s.modelText()).toContain(section);
    expect(s.modelText().endsWith(ASKED)).toBe(true);

    // And the transcript is the person's words, EXACTLY. `toContain` would pass over a token appended
    // to them, and the bytes are the behaviour here: what is on disk is what an agent in the box reads.
    expect(s.transcript()).toEqual([ASKED]);
  });

  // THE TOKEN ITSELF, asked for on its own, because the section is one composition of it and the
  // property is about the string. A future prefix that carried the token in a different wrapper would
  // pass the assertion above and fail this one.
  it('never writes the token to the transcript in any form', async () => {
    const root = await tempDir();
    const s = seam(TOKEN);

    await s.send(ASKED, root);

    expect(s.modelText()).toContain(TOKEN);
    for (const line of s.transcript()) expect(line).not.toContain(TOKEN);
  });
});
