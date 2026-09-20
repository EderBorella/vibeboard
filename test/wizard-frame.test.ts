import { describe, expect, it } from 'vitest';
import { foundationRel } from '../src/core/layout.js';
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
    expect(wizardFrame(null, undefined)).toBeUndefined();
  });

  // THE GATE THAT MAKES THIS SAFE. Every other step is an ordinary conversation — a person asking
  // the copilot anything at all — and a brief about writing foundation documents prepended to that
  // is the copilot answering a question nobody asked.
  it('says nothing on every step but docs', () => {
    for (const step of WIZARD_STEPS) {
      if (step === 'docs') continue;
      expect(wizardFrame(docs({ step }), undefined), step).toBeUndefined();
    }
    expect(wizardFrame(docs(), undefined)).toBeTypeOf('string');
  });

  // W7, which is the whole reason the frame exists: this is the person's first contact with the
  // product, and a wall of text here teaches them the assistant is work to read.
  it('carries the voice contract', () => {
    const frame = wizardFrame(docs(), undefined) ?? '';
    expect(frame).toContain('before anything else, how to speak');
    expect(frame).toContain('under 200 words');
    expect(frame).toContain('plain human language');
  });

  it('carries what the person told the form, and the stack they agreed', () => {
    const frame = wizardFrame(docs(), undefined) ?? '';
    expect(frame).toContain('a timeline of releases');
    expect(frame).toContain('my team');
    expect(frame).toContain('the tests pass');
    expect(frame).toContain('TypeScript, Vite and vitest');
  });

  // An unanswered question is a fact about the project, not a blank to paper over: the model is told
  // it was not answered so it can admit the gap rather than invent one.
  it('says which questions went unanswered rather than leaving a blank', () => {
    const frame = wizardFrame({ mode: 'greenfield', step: 'docs' }, undefined) ?? '';
    expect(frame).toContain('- What it is: (not answered)');
    expect(frame).toContain('- Who it is for: (not answered)');
    expect(frame).toContain('- What done looks like: (not answered)');
    expect(frame).toContain('- The agreed stack: (not agreed yet)');
  });

  it('asks for the résumé beside every document it writes', () => {
    const frame = wizardFrame(docs(), undefined) ?? '';
    expect(frame).toContain('PUT /api/wizard/resumes/:name');
    expect(frame).toContain('PUT /api/control/foundation/:name');
    expect(frame).toContain("I couldn't work out");
  });
});

// WHICH DOCUMENT THE PERSON MEANS, and it is a NAME rather than the document. The model has a Read
// tool, the person is about to talk about one line of one file, and inlining six documents into every
// message is tokens spent on nothing — the run-attachments rule. decision 78.
describe('the attached document', () => {
  it('names the path and binds the pronouns to it', () => {
    // The path is asked of `foundationRel` rather than typed out: a fixture spelling out where a
    // foundation document lives is wrong in exactly the way a second copy of the layout would be.
    const frame = wizardFrame(docs(), 'STACK.md') ?? '';
    expect(frame).toContain(`The person is looking at ${foundationRel('STACK.md')}`);
    expect(frame).toContain('"it" and "this document" mean that file');
  });

  it('says nothing about a document when none is attached', () => {
    const frame = wizardFrame(docs(), undefined) ?? '';
    expect(frame).not.toContain('The person is looking at');
    expect(frame).not.toContain('mean that file');
  });

  // The README is the one of the six that is not a foundation document: it lives at the root, and an
  // attachment that sent the model to `.vibeboard/foundation/README.md` would point it at nothing.
  it('puts the README at the root rather than under the foundation folder', () => {
    const frame = wizardFrame(docs(), 'README.md') ?? '';
    expect(frame).toContain('The person is looking at README.md right now');
    expect(frame).not.toContain(foundationRel('README.md'));
  });

  // THE REFUSAL, AND IT IS WHY THE SET IS FIXED. This field arrives from the browser, so anything it
  // carries is whatever the page said — and a name that is not one of the six résumé-able documents is
  // DROPPED rather than framed, so no string here can put an arbitrary path in front of the model.
  it('drops a name outside the résumé-able set rather than framing it', () => {
    for (const hostile of [
      '../../etc/passwd',
      '/etc/passwd',
      '.vibeboard/credentials.json',
      // A real file in every project, and still not one of the six.
      'CLAUDE.md',
      'stack.md',
      '',
    ]) {
      const frame = wizardFrame(docs(), hostile) ?? '';
      // The frame itself is there to receive it, so this is a refusal and not an empty screen.
      expect(frame, hostile).toContain('before anything else, how to speak');
      expect(frame, hostile).not.toContain('The person is looking at');
      expect(frame, hostile).not.toContain(hostile === '' ? 'mean that file' : hostile);
    }
  });

  // An attachment cannot resurrect the frame outside the documents step: the step gate is read first,
  // so an ordinary conversation stays one whatever the page attaches to it.
  it('adds nothing to a conversation that has no frame at all', () => {
    expect(wizardFrame(docs({ step: 'handoff' }), 'STACK.md')).toBeUndefined();
    expect(wizardFrame(null, 'STACK.md')).toBeUndefined();
  });
});

// The seam, through the real handler. There is no fake of `handleCopilotSend` here: the message goes
// in as a browser sends it and the fakes are at the edges the turn actually touches, because what is
// being proved is WHERE the frame is composed, which a unit test of the frame cannot see.
interface Seam {
  send: (text: string, root: string, attach?: string) => Promise<void>;
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
    // `attach` is the browser's field and rides the frame exactly as the dock sends it — an absent
    // one is absent from the JSON, which is the case every other test here drives.
    send: (text, root, attach) =>
      drive({ type: 'copilot:send', text, mode: 'bypassPermissions', attach }, root),
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

  // THROUGH THE DOOR THE DOCS STEP ACTUALLY LEAVES BY, and it is the half the pure test above cannot
  // reach: the step wrote no step at all, so the file sat at `docs` after every exit and this frame
  // prefixed EVERY later conversation on the project with a brief about writing foundation documents.
  // `gates` is the step it moves to when it tripped the gate block, and the frame has to be gone the
  // moment it does.
  it('is gone the moment setup has moved past the documents', async () => {
    const root = await tempDir();
    await writeWizardState(root, docs({ step: 'gates' }));
    const s = seam();

    await s.send('what is a gate command?', root);

    expect(s.modelText()).toBe('what is a gate command?');
  });

  it('is absent entirely on a project with no setup running', async () => {
    const root = await tempDir();
    const s = seam();

    await s.send('hello', root);

    expect(s.modelText()).toBe('hello');
  });

  // THE ATTACHMENT OVER THE WIRE, which the pure test cannot see: the name is a field on the frame the
  // browser sends, and what has to hold is that it reaches the FRAME and never the transcript — the
  // person typed a question about a document, not a sentence about where their eyes are.
  it('carries the document the page attached into the model’s copy, and not into the transcript', async () => {
    const root = await tempDir();
    await writeWizardState(root, docs());
    const s = seam();

    await s.send('make this one shorter', root, 'TESTING.md');

    expect(s.modelText()).toContain(`The person is looking at ${foundationRel('TESTING.md')}`);
    expect(s.modelText().endsWith('make this one shorter')).toBe(true);
    expect(s.transcript()).toEqual(['make this one shorter']);
  });

  // AND THE REFUSAL AT THE DOOR IT WOULD ARRIVE THROUGH. A hostile page can put any string in this
  // field; what stops it becoming a path in a prompt is the fixed set, and this is the only test that
  // drives the real wire frame into the real handler to say so.
  it('drops a name the page invented, with the frame still around it', async () => {
    const root = await tempDir();
    await writeWizardState(root, docs());
    const s = seam();

    await s.send('read this to me', root, '../../../etc/shadow');

    expect(s.modelText()).toContain('before anything else, how to speak');
    expect(s.modelText()).not.toContain('The person is looking at');
    expect(s.modelText()).not.toContain('etc/shadow');
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
