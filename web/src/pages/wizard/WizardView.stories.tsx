import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ComponentProps } from 'react';
import { config, snapshot } from '../../../../.storybook/fixtures';
import { EMPTY, withRoutes } from '../../../../.storybook/route-stub';
import type { ControlFile, ControlGroup, FileRead } from '../../lib/api';
import type { ProjectSnapshot, WizardState } from '../../lib/shared';
import { WizardView } from './WizardView';

// SETTING A PROJECT UP, AS A WHOLE SCREEN. Both stories are the identity step, which is the one that runs
// with NO project open — `snapshot: null` — and the only one whose two modes differ in what they ask: a
// new project needs somewhere to go and a name, and a repository already on disk is its own answer to
// both.
//
// IT WEARS ITS OWN CARD AND NOT `Pages/Gate`'s, though the box is the same. The browser harness proves the
// board by counting the picker's frame at zero and this screen renders with a project open, so a borrowed
// name would make that proof answer for two screens. Worth seeing side by side with `Pages/Gate` for
// exactly that reason.

// ANNOTATED for the reason `Pages/Log` records: a `RouteTable` value is `object`, so an un-annotated
// literal handed to the stub is checked by nothing at all. Nothing here fetches on mount — the identity
// step's two calls happen on a press — so the stub is what makes an accidental fetch a loud 501 rather
// than a screen that looks right.
const pending: { state: WizardState | null } = { state: null };

// THE TAB'S CONVERSATION, WHICH THE SHELL OWNS AND THIS SCREEN IS HANDED. Both stories below are the
// identity step, which renders none of it — the panel appears only in the documents step's review —
// but the prop is required, and a written-out stub says what the shell passes where a cast would hide
// it. Typed off the component so a field added to the dock shows up here as an error rather than as a
// story that renders half a panel.
//
// TWO CLOCKS AND THEREFORE TWO OBJECTS. They were one `quiet` shared by both, which is a fake keyed
// differently from the real thing: `useCopilot` holds two separate refs precisely because the
// difference between them is the whole of the thinking indicator's logic — time since dispatch against
// time since the last event. One object cannot express a turn that started four minutes ago and said
// something a second ago, so a story built on it could never show the state that matters.
const sentAt = { current: null };
const lastEventAt = { current: null };
const conversation: ComponentProps<typeof WizardView>['copilot'] = {
  copilot: {
    items: [],
    running: false,
    authorised: false,
    setCopilotAuthority: () => {},
    sessionId: undefined,
    model: undefined,
    stats: { costUsd: 0, turns: 0, lastDurationMs: 0, contextTokens: 0 },
    chats: [],
    currentChatId: undefined,
    send: () => {},
    compact: () => {},
    newSession: () => {},
    openChat: () => {},
    deleteChat: () => {},
    cancel: () => {},
    sentAt,
    lastEventAt,
    sawText: { current: false },
  },
  backend: 'claude-code',
  mode: 'bypassPermissions',
  model: 'sonnet',
  effort: 'medium',
  overridden: false,
  onMode: () => {},
  onModel: () => {},
  onEffort: () => {},
  onBackend: () => {},
  onReset: () => {},
};

const meta = {
  title: 'Pages/Wizard',
  component: WizardView,
  parameters: { layout: 'fullscreen' },
  decorators: [withRoutes({ ...EMPTY, '/api/wizard': pending })],
  args: {
    mode: 'greenfield',
    start: 'identity',
    snapshot: null,
    bump: 0,
    copilot: conversation,
    onOpened: () => {},
    onExit: () => {},
  },
} satisfies Meta<typeof WizardView>;
export default meta;

type Story = StoryObj<typeof meta>;

export const At900: Story = { globals: { viewport: { value: 'w900' } } };
export const At1200: Story = { globals: { viewport: { value: 'w1200' } } };
export const At1440: Story = { globals: { viewport: { value: 'w1440' } } };

// THE DOOR THAT CAME BACK. One field instead of two, because the folder already has a name — and the
// first surface in the product ever to send `mode: 'brownfield'`.
export const MapAnExistingRepository: Story = {
  args: { mode: 'brownfield' },
  globals: { viewport: { value: 'w1440' } },
};

// ---------- The review, which is the only step that is two columns ----------
//
// A DIFFERENT SCREEN FROM THE THREE ABOVE, and reached the way a person reaches it: setup RESUMED on a
// project whose file already carries the summaries. The step raises no offer and dispatches no turn over
// one of those — `snapshot: null` keeps that true here twice over — so the layout renders from the route
// table alone, which is the only reason a workbench with no server can show it at all.

const reviewed: { state: WizardState } = {
  state: {
    mode: 'greenfield',
    step: 'docs',
    answers: {
      what: 'A shared list of the meals we cook, so nobody has to plan dinner out of memory.',
      who: 'The two of us at home, on a phone in the kitchen.',
      done: 'We can see what we ate last week and pick from it in under a minute.',
    },
    stack: 'TypeScript, React and Vite, with Vitest for the tests. The list lives in the browser.',
    // ALL SIX, because the absent ones are a different story: a résumé map with gaps renders the quiet
    // placeholder card, and that is the writing screen rather than the review.
    resumes: {
      'README.md':
        'What this is and how to run it. It says the app is a shared list of meals for the people who cook them, and that everything runs on your own machine for now.',
      'STACK.md':
        'The tools this is built with: TypeScript, React, Vite and Vitest. It also says what is deliberately not here yet — no server, no database.',
      'CODE-QUALITY.md':
        'The three checks that must pass before anything is called done: the types, the linter and the tests. Each one is a command you can run yourself.',
      'TESTING.md':
        'How this is tested, and what a smoke test means here: start the app, add a meal, reload, and see it still there.',
      'UX.md':
        'How it should feel. One screen, big targets for a phone, and nothing that needs explaining. Adding a meal is the only thing it asks of you.',
      'DESIGN.md':
        'How it should look: one accent colour, generous spacing, the system font. I could not work out whether you want a dark mode, and the document says so.',
    },
  },
};

// THE LISTING IS THE SERVER'S FACT AND IS WRITTEN OUT HERE FOR EXACTLY THAT REASON: the cards turn a
// document's NAME into a path by asking for it, never by keeping a copy of the layout in the browser, so
// the stub is the one place in the front end where these paths may be spelled. ANNOTATED, on the precedent
// the route-stub file records: a `RouteTable` value is `object`, and an un-annotated literal is checked by
// nothing at all.
const foundationFiles: ControlFile[] = [
  'STACK.md',
  'CODE-QUALITY.md',
  'TESTING.md',
  'UX.md',
  'DESIGN.md',
].map((name) => ({
  path: `.vibeboard/foundation/${name}`,
  name,
  category: 'foundation',
  managed: true,
  deletable: false,
  renameable: false,
}));
const listing: { groups: ControlGroup[] } = {
  groups: [{ key: 'foundation', label: 'Foundation', files: foundationFiles, creatable: false }],
};

// `Read it all` really opens the file, through the two doors the six documents live behind: a foundation
// document is a control file, and the README is not one — it is at the project root and is read through the
// explorer. Both are answered here so the affordance is a control that does something rather than one that
// sits on `Opening…`.
const draft = (path: string): ControlFile & { content: string } => ({
  ...(foundationFiles.find((f) => f.path === path) ?? foundationFiles[0]),
  content: `# ${path.split('/').pop()}\n\nA short draft, written by the assistant during setup.\n`,
});
const readme: FileRead = {
  kind: 'text',
  path: 'README.md',
  name: 'README.md',
  size: 96,
  content: '# Meals\n\nA shared list of the meals we cook, so nobody has to plan dinner out of memory.\n',
};

// THE CONVERSATION THAT WROTE THEM, spread over the quiet stub above rather than written a second time:
// the review embeds the dock's panel on the tab's own instance, and an empty transcript beside six
// summaries is a screen that never happens — by the time this renders, the turn that filed them is in it.
const talking: ComponentProps<typeof WizardView>['copilot'] = {
  ...conversation,
  copilot: {
    ...conversation.copilot,
    items: [
      { id: 1, kind: 'user', text: "Please set up this project's documents from my answers." },
      { id: 2, kind: 'tool', text: '', toolName: 'control' },
      {
        id: 3,
        kind: 'assistant',
        text: 'All six are written, and each one has a short summary beside it. One thing I could not work out: whether you want a dark mode — it is written down as an open question rather than guessed at.',
      },
    ],
  },
};

const review: Story = {
  args: { start: 'docs', copilot: talking },
  decorators: [
    withRoutes({
      ...EMPTY,
      '/api/wizard': reviewed,
      '/api/control/files': listing,
      '/api/control/file': ({ query }) => draft(query.get('path') ?? ''),
      '/api/explorer/file': readme,
    }),
  ],
};

// THE THREE WIDTHS, because the cards side is what the conversation leaves over: the panel is the dock's
// organism at up to 420px and it does not shrink with the window, so this is the one screen in setup whose
// two halves are measured against each other rather than against the page.
export const ReviewAt900: Story = { ...review, globals: { viewport: { value: 'w900' } } };
export const ReviewAt1200: Story = { ...review, globals: { viewport: { value: 'w1200' } } };
export const ReviewAt1440: Story = { ...review, globals: { viewport: { value: 'w1440' } } };

// ---------- The journey's last two steps ----------
//
// BOTH RENDER FROM THE FILE AND THE PROJECT'S OWN SETTINGS, which is the only reason a workbench with
// no server can show them: the import asks the network for nothing until `Bring it in` is pressed, and
// the ending reads the file, the config and one readiness answer. The tables below stand in for all
// three, and `EMPTY`'s readiness is the honest empty — nothing blocking.

// A PROJECT WITH A KIND. The shared snapshot's config carries no box block, and the ending says what
// kind of project this is — so without one that line is omitted, which is the state a resumed setup
// shows rather than the one these stories are about. Typed, for the reason every table here is.
const kinded: ProjectSnapshot = { ...snapshot, config: { ...config, box: { kind: 'web' } } };

// THE FILE AS IT STANDS ONCE THE DOCUMENTS ARE DONE, carried whole into both steps because that is
// what is on disk at each of them: the three answers, the stack as agreed, all six summaries. Spread
// off the review's own state rather than written a second time — a story that trimmed it would be
// describing a setup that cannot have reached these screens.
const importing: { state: WizardState } = { state: { ...reviewed.state, step: 'import' } };
const ending: { state: WizardState } = { state: { ...reviewed.state, step: 'ready' } };

// THE QUESTION AND ITS TWO DOORS. The yes-side — the list box and the one-liner — opens on a press,
// which a story cannot make; what is here is the screen every person meets, and the one most of them
// leave through the no-door (W1).
const importStep: Story = {
  args: { start: 'import', snapshot: kinded },
  decorators: [withRoutes({ ...EMPTY, '/api/wizard': importing })],
};

export const ImportAt900: Story = { ...importStep, globals: { viewport: { value: 'w900' } } };
export const ImportAt1200: Story = { ...importStep, globals: { viewport: { value: 'w1200' } } };
export const ImportAt1440: Story = { ...importStep, globals: { viewport: { value: 'w1440' } } };

// THE ENDING: what was set up, whether anything is still missing, and the one thing left to press.
// The import's own closing sentence is absent here for the reason it is absent from the browser
// harness — it is the model's, and it lives in the step that heard it rather than on disk.
const ready: Story = {
  args: { start: 'ready', snapshot: kinded },
  decorators: [withRoutes({ ...EMPTY, '/api/wizard': ending })],
};

export const ReadyAt900: Story = { ...ready, globals: { viewport: { value: 'w900' } } };
export const ReadyAt1200: Story = { ...ready, globals: { viewport: { value: 'w1200' } } };
export const ReadyAt1440: Story = { ...ready, globals: { viewport: { value: 'w1440' } } };
