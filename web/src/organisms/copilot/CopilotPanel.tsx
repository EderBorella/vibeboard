import { useEffect, useRef, useState } from 'react';
import { Button } from '../../atoms/Button';
import { Control } from '../../atoms/Control';
import { Icon } from '../../atoms/Icon';
import { Readout } from '../../atoms/Readout';
import { Stack } from '../../atoms/Stack';
import { Text } from '../../atoms/Text';
import { stateClass } from '../../design/state-tones';
import { getModelStatus, listModels, type ModelOption, type ModelStatus } from '../../lib/api';
import { backendCaps, backendDefaults } from '../../lib/shared';
import { useConfirm } from '../../lib/useConfirm';
import { useFetched } from '../../lib/useFetched';
import { StatusChip } from '../../molecules/StatusChip';
import { BackendPicker } from './BackendPicker';
import { ChatSwitcher } from './ChatSwitcher';
import { CopilotControls } from './CopilotControls';
import { CopilotReadout } from './CopilotReadout';
import { clampToCaps } from './choice';
import { ThinkingIndicator } from './ThinkingIndicator';
import type { CopilotMode, EffortLevel, TranscriptItem, useCopilot } from './useCopilot';

const NO_MODELS: ModelOption[] = [];

// THE FIFTH MECHANISM, AND NO CENSUS COUNTED IT. `.copilot-status.ok` and `.down` were bare class names
// that picked `--accent` and `--danger` by hand — neither looked like a state, so the six vocabularies
// docs/design-system.md measured were really seven. `available`/`unavailable` are rows in
// design/state-tones.ts now, the word is computed once instead of three times, and the halo is a `Dot` prop
// rather than a colour rule of its own.
//
// Its own component because the panel sits on the cognitive-complexity limit and this is a conditional
// branch on top of eleven — the gate refusing it inline is the gate working, exactly as it was for
// `AgentChip` on the auto-pilot bar.
function BackendStatus({ status }: { status: ModelStatus }) {
  const state = status.up ? 'available' : 'unavailable';
  const facts = [
    status.uptime != null && `${status.uptime.toFixed(1)}% uptime`,
    `${status.endpoints} provider${status.endpoints === 1 ? '' : 's'}`,
  ].filter(Boolean);
  return (
    // THE FOURTH INDICATOR, AND IT IS A `StatusChip`. It was a full-width row with the word and two
    // numbers glued to it by ` · `, so the state you were looking for was the shortest thing on a line of
    // three facts — and the row itself was the fifth mechanism no census counted, because `.ok` and
    // `.down` did not look like states.
    //
    // THE TWO NUMBERS MOVE INTO THE BALLOON rather than being dropped. That is where the other three
    // indicators put their detail, and neither number is something you read at a glance: an uptime
    // percentage is what you go and check once the word has told you to.
    //
    // AND IT HAS NO ROW OF ITS OWN NOW EITHER. The strip it lived in — between the selects and the
    // transcript — padded itself `[2, 5]`, 4px where every other row in the dock uses 8px, so one chip
    // was giving the dock a fifth vertical rhythm and a sixth horizontal rule. This is a property OF
    // the backend, and the backend picker is in the header; it goes beside it. What is left here is
    // the chip alone, so the caller decides where it sits.
    <StatusChip
      state={state}
      word={state}
      advice={{
        heading: status.up ? 'This backend is answering' : 'This backend is not answering',
        detail: facts.join(' · '),
      }}
      glow={status.up}
      testId="copilot-status"
    />
  );
}

// ONE CHAT LINE. `data-state` ONLY FOR THE KIND THAT IS A STATE: `msg-user` and `msg-assistant` are
// bubble GEOMETRY and `msg-running` is quietness — the chat may keep its own shape. `.msg-thinking` is
// gone: it was `Text role="hint"` value for value, on a span that is a child of `.msg` rather than `.msg`
// itself, so nothing contended with the atom for the step or the ink.
// `.msg-error` was the one that decided a colour, `--danger`, outside any table; it is the `error` row
// now and the class is gone.
//
// Lifted out of the panel for `BackendStatus`’s reason: two conditionals of its own on a function
// already at the limit.
function MessageLine({ item, onRetry }: { item: TranscriptItem; onRetry?: () => void }) {
  const error = item.kind === 'error';
  // OFFERED ON THE LAST ERROR ONLY, and only when the server called the failure retryable. `onRetry`
  // is absent on every other line, so a transcript scrolled back through does not sprout buttons that
  // would resend the current message from beside an old failure.
  const retry = error && item.retryable && onRetry;
  return (
    <div
      className={error ? `msg ${stateClass('error')}` : `msg msg-${item.kind}`}
      data-state={error ? 'error' : undefined}
    >
      {item.kind === 'tool' ? (
        // The name of a tool the agent called is machine vocabulary, and `.msg-tool` said so by hand in
        // `--t-small` accent mono — which is `Readout` `small` `accent` value for value.
        <Readout>
          <Icon name="tool" /> {item.toolName}
        </Readout>
      ) : item.kind === 'thinking' ? (
        // `--t-small` muted italic, which is this atom's default face plus the hint role.
        <Text role="hint">{item.text}</Text>
      ) : (
        item.text
      )}
      {retry && (
        // Inside the bubble rather than beside it: the remedy belongs to the failure it answers, and a
        // control floating in the transcript would have nothing naming what it retries.
        <Stack gap={3} pad={[3, 0, 0]}>
          <Button size="sm" onClick={onRetry} title="Send the same message again">
            Retry
          </Button>
        </Stack>
      )}
    </div>
  );
}

// THE COMPOSER, AND IT HOLDS THE DRAFT. Its own component for `BackendStatus`'s and `MessageLine`'s
// reason, measured rather than assumed: `compact` took the panel from 15 to 16 on biome's
// cognitive-complexity limit, and this is the block that comes out cleanest — a text box, an Enter
// binding and one of two buttons, with no read of the dock's state at all.
//
// THE PLACEHOLDER IS A PROP because a composer's label IS its placeholder, and the one thing an
// embedder must be able to say in its own voice is what to type here. The dock's own wording names the
// copilot, which setup's plain-words sweep refuses (W7).
function Composer({
  running,
  placeholder,
  onSend,
  onCancel,
}: {
  running: boolean;
  placeholder?: string;
  onSend: (text: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState('');
  const submit = (): void => {
    if (!draft.trim() || running) return;
    onSend(draft);
    setDraft('');
  };
  return (
    // `align="stretch"` is what the row named no `align-items` for: the textarea and the button beside
    // it have always filled its height.
    <Stack align="stretch" className="copilot-input">
      {/* NOT a `Field`: a composer's label is its placeholder and the Send button beside it. */}
      <Control
        as="textarea"
        value={draft}
        placeholder={running ? 'Running…' : (placeholder ?? 'Message the copilot (Enter to send)')}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        rows={3}
      />
      {running ? (
        <Button size="md" onClick={onCancel}>
          Stop
        </Button>
      ) : (
        <Button variant="primary" size="md" onClick={submit} disabled={!draft.trim()}>
          Send
        </Button>
      )}
    </Stack>
  );
}

interface Props {
  copilot: ReturnType<typeof useCopilot>;
  backend: string;
  mode: CopilotMode;
  model: string;
  effort: EffortLevel;
  onMode: (m: CopilotMode) => void;
  onModel: (m: string) => void;
  onEffort: (e: EffortLevel) => void;
  onBackend: (b: string) => void;
  // True when any dock control differs from the configured default; clearing goes back to it.
  contextBudget: number;
  overridden: boolean;
  onReset: () => void;
  // THE DOCK'S ✕, AND OPTIONAL BECAUSE `compact` RENDERS NO HEADER TO PUT IT IN. Setup's review embeds
  // this panel with no way to hide it — there is nothing behind it to go back to — so a handler threaded
  // there would be wiring to a control that does not exist. App passed one for months.
  onClose?: () => void;
  // THE SAME CONVERSATION WITHOUT THE DOCK AROUND IT (ruling W11). The transcript, the composer, the
  // thinking indicator and the Cancel under it; nothing else. Every control this drops belongs to the
  // DOCK rather than to the conversation — which backend, which model, which effort, the chat history,
  // the authority grant, the spend readout and the ✕ — and on setup's review screen each of them is
  // either a second answer to a question the wizard has already asked or a way out of a screen that has
  // one. See pages/wizard/WizardView.tsx, `ReviewLayout`.
  compact?: boolean;
  // A COMPOSER'S LABEL IS ITS PLACEHOLDER, so an embedder that speaks a different language to the
  // person needs this to be its own: the dock says "Message the copilot", which is a word setup's
  // plain-words sweep refuses (W7).
  placeholder?: string;
}

export function CopilotPanel({
  copilot,
  backend,
  mode,
  model,
  effort,
  contextBudget,
  onMode,
  onModel,
  onEffort,
  onBackend,
  overridden,
  onReset,
  onClose,
  compact,
  placeholder,
}: Props) {
  const {
    items,
    running,
    stats,
    chats,
    currentChatId,
    send,
    // The hook's "compact the conversation" call, renamed because the PROP beside it is a different
    // question — whether this panel wears its dock chrome at all.
    compact: compactConversation,
    newSession,
    openChat,
    deleteChat,
    cancel,
    authorised,
    setCopilotAuthority,
    sentAt,
    lastEventAt,
    sawText,
  } = copilot;
  const { confirm, dialog } = useConfirm();
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Modes and efforts are backend-specific, so a selection carried across a backend switch
  // gets clamped to what this backend actually publishes. The model arrives already
  // resolved — App owns precedence.
  const caps = backendCaps(backend);
  const { mode: effMode, effort: effEffort } = clampToCaps({ backend, model, effort }, mode);

  // Model choices depend on the configured backend (claude aliases vs opencode models). Emptied on a
  // failure rather than kept: this is a menu of what can be chosen now, and one backend's aliases are
  // not offerable under the other.
  //
  // NOT ASKED AT ALL UNDER `compact`, which renders neither the menu nor the warning below it: the only
  // honest reason to fetch a list of choices is to offer them.
  const { value: models } = useFetched(() => listModels(backend), [backend], NO_MODELS, {
    enabled: !compact,
    onFailure: 'clear',
  });

  // Warn when the chosen model can't call tools — the copilot can't touch cards without them.
  const noTools = models.find((m) => m.id === model)?.caps?.toolCall === false;

  // Live status/uptime for the selected model (OpenRouter only; null otherwise). Skipped under
  // `compact` for the model list's reason: the chip it feeds is in the header, which is not rendered.
  useEffect(() => {
    let live = true;
    setStatus(null);
    if (compact) return;
    getModelStatus(model)
      .then((s) => {
        if (live) setStatus(s);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [model, compact]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: items/running are scroll triggers
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [items, running]);

  // Always concrete — the server would fill these in anyway, and sending them keeps what the
  // UI shows and what runs the same thing.
  // The backend goes too: the dock is a session override, so the server can't assume the
  // configured one is in force.
  const turnOpts = () => ({ mode: effMode, backend, model, effort: effEffort });

  // RESEND THE LAST THING THE USER ASKED, WITH THE OPTIONS IN FORCE NOW — deliberately not the ones
  // the failed turn used. A rate limit is most often answered by switching model, and a Retry that
  // insisted on the model that was just throttled would be the least useful button on the surface.
  // `turnOpts()` is the same call `submit` makes, so Retry and Send cannot disagree about what runs.
  //
  // The LAST user line rather than a remembered string: the transcript is already the record, and a
  // separate copy would be a second source that drifts the moment a chat is switched or reopened.
  const lastUserText = [...items].reverse().find((it) => it.kind === 'user')?.text;
  const retry = lastUserText && !running ? () => send(lastUserText, turnOpts()) : undefined;
  // Only the FINAL item may offer it. An error four messages back has been answered by whatever came
  // after it, and a button there would resend today's message from beside yesterday's failure.
  const lastId = items.length > 0 ? items[items.length - 1]?.id : undefined;

  return (
    <aside className="copilot">
      {/* THE WHOLE OF THE DOCK'S CHROME, AND `compact` DROPS ALL OF IT (ruling W11). Everything between
          here and the transcript answers a question the DOCK asks — which backend, which chat, may it
          write, which model and effort, what has it cost — and setup's review has already answered every
          one of them on an earlier screen or in the project's own config. What is left when they go is
          the conversation: the transcript, what it is doing, and the box to reply in. */}
      {!compact && (
        <>
          {/* THE DOCK GUTTER AND THE RULE UNDER THE ROW ARE `Stack` OPTIONS NOW, on this and four siblings:
          five classes that each said `padding: var(--s-N) var(--s-5)` and one hairline. */}
          <Stack pad={[4, 5]} edge="bottom">
            {/* THE ◈ IS AN ICON AND NOT A `content:` GLYPH, since 2026-09-02. `.copilot-title::before` held
            it, which is a place no sweep of the components could reach, and it carried the same ink
            offset every other mark did. `Text ink="accent"` is what the pseudo-element's `color` was. */}
            <Text ink="accent">
              <Icon name="diamond" />
            </Text>
            <span className="copilot-title">Copilot</span>
            <BackendPicker
              value={backend}
              disabled={running}
              label="Backend"
              titleFor={(b) =>
                running ? 'Finish the current turn first' : `Switch to ${b.label} (starts a new chat)`
              }
              onChange={onBackend}
            />
            {/* THE BACKEND'S STATE, BESIDE THE BACKEND. `status` is null until the probe answers, and it
            stays null for every backend that is not OpenRouter — so this appears and disappears. It is
            the one thing in this row that may do that: it sits between the picker and the `push`, so
            what moves when it arrives is nothing, rather than the ✕. */}
            {status && <BackendStatus status={status} />}
            {/* NO MODEL NAME HERE. It used to render the model the SERVER reported for the live session,
            so it appeared only once a turn had run and was absent in a fresh chat — the same header
            with and without a name, which is a layout that moves for a reason nobody can see. A name
            like `opencode/nemotron-3-ultra-free` is 30 characters in a row whose other members are a
            title, a two-cell picker and a `✕`, and it pushed them out of place.

            The picker below already names the model, and it names the one that will be USED. This
            named the one in force, which differs only between selecting a model and running the next
            turn — a distinction worth less than a row that holds still. */}
            {/* Not in the ratchet — Phase 2's control reset took its font-size away, so no rule gave it
            geometry any more — but the same `✕` as nine others, so it goes with them. */}
            <Button variant="bare" className="push" onClick={onClose} title="Hide (session keeps running)">
              <Icon name="close" />
            </Button>
          </Stack>

          <ChatSwitcher
            chats={chats}
            currentChatId={currentChatId}
            backend={backend}
            running={running}
            onOpen={openChat}
            onDelete={(chatId) => {
              const chat = chats.find((c) => c.id === chatId);
              void confirm({
                title: 'Delete this chat?',
                // Named: the switcher lists several, and they are told apart by their first line.
                body: `“${chat?.title ?? chatId}” is removed from disk. This cannot be undone.`,
                action: 'Delete chat',
                danger: true,
              }).then((ok) => {
                if (ok) deleteChat(chatId);
              });
            }}
            onNew={newSession}
          />

          {/*
        WHAT THE COPILOT MAY DO TO THE PROJECT, and it is off until you say otherwise.

        Unauthorised it can read anything and write ordinary project files; the whole of `.vibeboard/`
        is denied to it by the OS, so it cannot touch the board, the config or the foundation documents
        however it is asked to. Authorising mints a credential for THIS conversation, which the server
        revokes when the chat or the project changes.

        The confirm is not ceremony: the grant includes writing the foundation documents, and two of
        those carry commands the server later runs outside the sandbox as you.
      */}
          {/* THE ROW THAT NEVER GOT A CLASS, and now no row in the dock needs one. It was a bare `<div>` with
          no padding while its six siblings each declared the dock gutter, so the one button that grants
          write access to the project sat flush against the panel's left edge, touching the board behind
          it. Nothing chose that — and a gutter that is an attribute on the layout atom is a gutter you
          cannot forget to write. test/copilot-rows.test.tsx holds all seven to it. */}
          <Stack pad={[4, 5]} edge="bottom">
            {/* The ternary was `btn-primary`/`btn-secondary` — a toggle whose "on" state is the filled one.
            It is also the one site the ratchet could not see, because a class reaching a `<button>`
            through an expression is not a literal in the attribute text; the check names that gap. */}
            <Button
              variant={authorised ? 'primary' : 'default'}
              size="md"
              onClick={() => {
                if (authorised) {
                  setCopilotAuthority(false);
                  return;
                }
                void confirm({
                  title: 'Let the copilot change this project?',
                  body: 'It will be able to create, edit, move and archive cards, and to write the five foundation documents — through the API, for this conversation only. Two of those documents hold commands that auto-pilot later runs outside the sandbox, as you; if it changes one, auto-pilot will not start until you have read them.',
                  action: 'Authorise',
                }).then((ok) => {
                  if (ok) setCopilotAuthority(true);
                });
              }}
              title={
                authorised
                  ? 'The copilot holds a credential for this conversation. Click to revoke it.'
                  : 'The copilot can read everything and change nothing. Click to let it use the API.'
              }
            >
              {authorised ? 'Authorised' : 'Authorise'}
            </Button>
          </Stack>

          <CopilotControls
            caps={caps}
            effMode={effMode}
            effEffort={effEffort}
            effModel={model}
            defaultModel={backendDefaults(backend).model}
            models={models}
            running={running}
            onMode={onMode}
            onModel={onModel}
            onEffort={onEffort}
            onCompact={() => compactConversation(turnOpts())}
          />

          {overridden && (
            // `--s-4` AND NOT THE DOCK GUTTER, deliberately: this is the one strip that reads as an aside
            // inside the dock rather than as a row of it, which test/copilot-rows.test.tsx names as an
            // exclusion rather than widening its claim to cover.
            <Stack pad={[2, 4]}>
              <Text size="micro">Just for this session — the project default is unchanged.</Text>
              <Button size="sm" className="push" onClick={onReset} disabled={running}>
                Use default
              </Button>
            </Stack>
          )}
          {noTools && (
            <div className="copilot-warn" role="alert">
              {/* `role="error"` IS THE `--t-small` DANGER LINE THE CLASS DECLARED BY HAND. The tinted strip
              stays a class: a `color-mix` ground is this warning's own and no atom carries one. */}
              <Text role="error">
                <Icon name="warning" /> This model can’t use tools — the copilot can’t create or edit cards.
                Pick one marked for tool use.
              </Text>
            </div>
          )}
        </>
      )}

      <Stack direction="column" gap={4} pad={5} fill scroll ref={bodyRef}>
        {/* THE DOCK'S OWN SENTENCE, and it goes with the rest of the chrome: it names the backend and
            the copilot, which is the dock explaining itself, and an embedder has already said what the
            conversation is for in its own words. An empty transcript under `compact` shows nothing. */}
        {!compact && items.length === 0 && (
          <Text role="hint" lead>
            Ask the copilot to work on this project. It runs your configured backend ({backend}) in the
            project folder, so card changes appear on the board as it works.
          </Text>
        )}
        {/* THE MODEL'S OWN WORDS AND NOTHING ELSE, which is what the handle claims: setup's plain-words
            sweep skips this element by name (W7), so what it wraps has to be the transcript and not the
            box the transcript sits in. It wrapped the whole embedded panel until the chrome went — with
            the composer, the selects and the readout inside the exemption, none of which the model
            wrote. The sentence above is outside it for the same reason. */}
        <Stack direction="column" gap={4} testId="verbatim-conversation">
          {items.map((it) => (
            <MessageLine key={it.id} item={it} onRetry={it.id === lastId ? retry : undefined} />
          ))}
        </Stack>
        {/* THE INDICATOR REPLACES `…working`, which was the whole of the old signal: a static string
            that said the same thing at one second and at three minutes. It could not distinguish a
            model that was thinking from a process that had died — which is the complaint this came from,
            raised from real use rather than from review.
            `!sawText.current` — once the answer starts arriving the bubble IS the signal, and two
            things saying "working" is one too many. The ref is read during a render that `items`
            already triggered, so it is never stale here. */}
        {running && !sawText.current && (
          <ThinkingIndicator sentAt={sentAt} lastEventAt={lastEventAt} onCancel={cancel} />
        )}
      </Stack>

      {!compact && <CopilotReadout stats={stats} budget={contextBudget} />}

      <Composer
        running={running}
        placeholder={placeholder}
        onSend={(text) => send(text, turnOpts())}
        onCancel={cancel}
      />

      {dialog}
    </aside>
  );
}
