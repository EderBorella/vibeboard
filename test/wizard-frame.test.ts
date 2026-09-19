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
  modelText: () => string;
  transcript: () => string[];
}

function seam(): Seam {
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
      forTurn: async () => undefined,
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
