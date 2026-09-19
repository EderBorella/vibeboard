import { describe, expect, it } from 'vitest';
import { fixedSandbox } from '../src/server/boxes/sandbox.js';
import { createCopilotTurns } from '../src/server/copilot/copilot-turns.js';
import { wizardFrame } from '../src/server/copilot/wizard-frame.js';
import type { AppCtx } from '../src/server/route-context.js';
import { WIZARD_STEPS, type WizardState, writeWizardState } from '../src/store/project/wizard.js';
import { tempDir } from './helpers.js';

// THE WIZARD'S VOICE CONTRACT, and the seam it is composed at. Two halves: the text is a pure
// function of the state, and the only place it is allowed to reach is the model's copy of a message.
// A frame in the transcript is a leak — the person would read the brief written about them, in their
// own conversation. decision 77.

const docs = (over: Partial<WizardState> = {}): WizardState => ({
  mode: 'brownfield',
  step: 'docs',
  answers: { what: 'a timeline of releases', who: 'my team', done: 'the tests pass' },
  stack: 'TypeScript, Vite and vitest',
  ...over,
});

describe('wizardFrame', () => {
  it('says nothing at all when there is no setup running', () => {
    expect(wizardFrame(null)).toBeUndefined();
  });

  // THE GATE THAT MAKES THIS SAFE. Every other step is an ordinary conversation — a person asking
  // the copilot anything at all — and a brief about writing foundation documents prepended to that
  // is the copilot answering a question nobody asked.
  it('says nothing on every step but docs', () => {
    for (const step of WIZARD_STEPS) {
      if (step === 'docs') continue;
      expect(wizardFrame(docs({ step })), step).toBeUndefined();
    }
    expect(wizardFrame(docs())).toBeTypeOf('string');
  });

  // W7, which is the whole reason the frame exists: this is the person's first contact with the
  // product, and a wall of text here teaches them the assistant is work to read.
  it('carries the voice contract', () => {
    const frame = wizardFrame(docs()) ?? '';
    expect(frame).toContain('before anything else, how to speak');
    expect(frame).toContain('under 200 words');
    expect(frame).toContain('plain human language');
  });

  it('carries what the person told the form, and the stack they agreed', () => {
    const frame = wizardFrame(docs()) ?? '';
    expect(frame).toContain('a timeline of releases');
    expect(frame).toContain('my team');
    expect(frame).toContain('the tests pass');
    expect(frame).toContain('TypeScript, Vite and vitest');
  });

  // An unanswered question is a fact about the project, not a blank to paper over: the model is told
  // it was not answered so it can admit the gap rather than invent one.
  it('says which questions went unanswered rather than leaving a blank', () => {
    const frame = wizardFrame({ mode: 'greenfield', step: 'docs' }) ?? '';
    expect(frame).toContain('- What it is: (not answered)');
    expect(frame).toContain('- Who it is for: (not answered)');
    expect(frame).toContain('- What done looks like: (not answered)');
    expect(frame).toContain('- The agreed stack: (not agreed yet)');
  });

  it('asks for the résumé beside every document it writes', () => {
    const frame = wizardFrame(docs()) ?? '';
    expect(frame).toContain('PUT /api/wizard/resumes/:name');
    expect(frame).toContain('PUT /api/control/foundation/:name');
    expect(frame).toContain("I couldn't work out");
  });
});

// The seam, through the real handler. There is no fake of `handleCopilotSend` here: the message goes
// in as a browser sends it and the fakes are at the edges the turn actually touches, because what is
// being proved is WHERE the frame is composed, which a unit test of the frame cannot see.
interface Seam {
  send: (text: string, root: string) => Promise<void>;
  // The dock's other button, which sends no words of its own: the CLI's own slash command.
  compact: (root: string) => Promise<void>;
  modelText: () => string;
  transcript: () => string[];
}

// `token` authorises the conversation, exactly as a person pressing Authorise does — the credential
// section is the OTHER thing prepended at this seam, and the two together are what the compact case
// has to survive.
function seam(token?: string): Seam {
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
      forTurn: async () => (token === undefined ? undefined : { token }),
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
  const drive = async (message: object, root: string): Promise<void> => {
    (ctx.session as { root?: string }).root = root;
    const done = new Promise<void>((resolve) => {
      settle = resolve;
    });
    turns.handleMessage(JSON.stringify(message));
    await done;
  };
  return {
    send: (text, root) => drive({ type: 'copilot:send', text, mode: 'bypassPermissions' }, root),
    // The browser sends no text with this one — the sentinel is the handler's, which is exactly why
    // it has to be driven through `handleMessage` rather than composed here.
    compact: (root) => drive({ type: 'copilot:compact', mode: 'bypassPermissions' }, root),
    modelText: () => sent,
    transcript: () => recorded,
  };
}

describe('the frame at the copilot seam', () => {
  it('brief the model, not the person: the frame reaches send and never the transcript', async () => {
    const root = await tempDir();
    await writeWizardState(root, docs());
    const s = seam();

    await s.send('Please set up this project’s documents from my answers.', root);

    expect(s.modelText()).toContain('before anything else, how to speak');
    expect(s.modelText()).toContain('a timeline of releases');
    // Their words, last, after the frame and its rule — and unchanged.
    expect(s.modelText().endsWith('Please set up this project’s documents from my answers.')).toBe(true);
    expect(s.transcript()).toEqual(['Please set up this project’s documents from my answers.']);
  });

  it('leaves an ordinary conversation exactly as it was typed', async () => {
    const root = await tempDir();
    await writeWizardState(root, docs({ step: 'handoff' }));
    const s = seam();

    await s.send('what does the archive drawer do?', root);

    expect(s.modelText()).toBe('what does the archive drawer do?');
    expect(s.transcript()).toEqual(['what does the archive drawer do?']);
  });

  it('is absent entirely on a project with no setup running', async () => {
    const root = await tempDir();
    const s = seam();

    await s.send('hello', root);

    expect(s.modelText()).toBe('hello');
  });
});

// THE ONE MESSAGE NOTHING MAY PREFIX. `/compact` is the CLI's own command and it is only a command
// while it is the first thing in the message — put a credential section or a frame in front of it and
// the CLI reads a paragraph ending in the word "/compact", compacts nothing, and answers about it.
// Broken by the credential half since authority shipped; the frame would have been the second way.
describe('the compact sentinel', () => {
  it('reaches the model verbatim even where both prefixes would have applied', async () => {
    const root = await tempDir();
    await writeWizardState(root, docs());
    const s = seam('a-real-token');

    // THE SAME CONVERSATION PROVES BOTH HALVES. An ordinary message here gets the credential section
    // and the frame — so the assertion below is about the sentinel and not about a seam that happens
    // to be prefixing nothing today.
    await s.send('what should the README say?', root);
    expect(s.modelText()).toContain('Your credential: `a-real-token`');
    expect(s.modelText()).toContain('before anything else, how to speak');

    await s.compact(root);

    expect(s.modelText()).toBe('/compact');
    // And the transcript records what the person pressed, as it does for every other turn.
    expect(s.transcript()).toEqual(['what should the README say?', '/compact']);
  });
});
