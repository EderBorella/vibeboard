import { useEffect, useRef, useState } from 'react';
import { Button } from '../../atoms/Button';
import { Control } from '../../atoms/Control';
import { Readout } from '../../atoms/Readout';
import { Stack } from '../../atoms/Stack';
import { Text } from '../../atoms/Text';
import { getModelStatus, listModels, type ModelOption, type ModelStatus } from '../../lib/api';
import { backendCaps, backendDefaults } from '../../lib/shared';
import { useConfirm } from '../../lib/useConfirm';
import { useFetched } from '../../lib/useFetched';
import { StatusChip } from '../../molecules/StatusChip';
import { stateClass } from '../../molecules/state-tones';
import { BackendPicker } from './BackendPicker';
import { ChatSwitcher } from './ChatSwitcher';
import { CopilotControls } from './CopilotControls';
import { CopilotReadout } from './CopilotReadout';
import { clampToCaps } from './choice';
import type { CopilotMode, EffortLevel, TranscriptItem, useCopilot } from './useCopilot';

const NO_MODELS: ModelOption[] = [];

// THE FIFTH MECHANISM, AND NO CENSUS COUNTED IT. `.copilot-status.ok` and `.down` were bare class names
// that picked `--accent` and `--danger` by hand — neither looked like a state, so the six vocabularies
// docs/design-system.md measured were really seven. `available`/`unavailable` are rows in
// molecules/state-tones.ts now, the word is computed once instead of three times, and the halo is a `Dot` prop
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
    // THE FOURTH INDICATOR, AND IT IS A `StatusChip` NOW. It was a full-width row with the word and two
    // numbers glued to it by ` · `, so the state you were looking for was the shortest thing on a line of
    // three facts — and the row itself was the fifth mechanism no census counted, because `.ok` and
    // `.down` did not look like states.
    //
    // THE TWO NUMBERS MOVE INTO THE BALLOON rather than being dropped. That is where the other three
    // indicators put their detail, and neither number is something you read at a glance: an uptime
    // percentage is what you go and check once the word has told you to.
    <Stack gap={3} pad={[2, 5]} edge="bottom">
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
    </Stack>
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
function MessageLine({ item }: { item: TranscriptItem }) {
  const error = item.kind === 'error';
  return (
    <div
      className={error ? `msg ${stateClass('error')}` : `msg msg-${item.kind}`}
      data-state={error ? 'error' : undefined}
    >
      {item.kind === 'tool' ? (
        // The name of a tool the agent called is machine vocabulary, and `.msg-tool` said so by hand in
        // `--t-small` accent mono — which is `Readout` `small` `accent` value for value.
        <Readout>⚙ {item.toolName}</Readout>
      ) : item.kind === 'thinking' ? (
        // `--t-small` muted italic, which is this atom's default face plus the hint role.
        <Text role="hint">{item.text}</Text>
      ) : (
        item.text
      )}
    </div>
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
  onClose: () => void;
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
}: Props) {
  const {
    items,
    running,
    model: activeModel,
    stats,
    chats,
    currentChatId,
    send,
    compact,
    newSession,
    openChat,
    deleteChat,
    cancel,
    authorised,
    setCopilotAuthority,
  } = copilot;
  const { confirm, dialog } = useConfirm();
  const [draft, setDraft] = useState('');
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
  const { value: models } = useFetched(() => listModels(backend), [backend], NO_MODELS, {
    onFailure: 'clear',
  });

  // Warn when the chosen model can't call tools — the copilot can't touch cards without them.
  const noTools = models.find((m) => m.id === model)?.caps?.toolCall === false;

  // Live status/uptime for the selected model (OpenRouter only; null otherwise).
  useEffect(() => {
    let live = true;
    setStatus(null);
    getModelStatus(model)
      .then((s) => {
        if (live) setStatus(s);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [model]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: items/running are scroll triggers
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [items, running]);

  // Always concrete — the server would fill these in anyway, and sending them keeps what the
  // UI shows and what runs the same thing.
  // The backend goes too: the dock is a session override, so the server can't assume the
  // configured one is in force.
  const turnOpts = () => ({ mode: effMode, backend, model, effort: effEffort });
  const submit = (): void => {
    if (!draft.trim() || running) return;
    send(draft, turnOpts());
    setDraft('');
  };

  return (
    <aside className="copilot">
      {/* THE DOCK GUTTER AND THE RULE UNDER THE ROW ARE `Stack` OPTIONS NOW, on this and four siblings:
          five classes that each said `padding: var(--s-N) var(--s-5)` and one hairline. */}
      <Stack pad={[4, 5]} edge="bottom">
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
        {activeModel && <Readout>{activeModel}</Readout>}
        {/* Not in the ratchet — Phase 2's control reset took its font-size away, so no rule gave it
            geometry any more — but the same `✕` as nine others, so it goes with them. */}
        <Button variant="bare" className="push" onClick={onClose} title="Hide (session keeps running)">
          ✕
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
        onCompact={() => compact(turnOpts())}
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
            ⚠ This model can’t use tools — the copilot can’t create or edit cards. Pick a 🔧 model.
          </Text>
        </div>
      )}
      {status && <BackendStatus status={status} />}

      <div className="copilot-body" ref={bodyRef}>
        {items.length === 0 && (
          <Text role="hint" lead>
            Ask the copilot to work on this project. It runs your configured backend ({backend}) in the
            project folder, so card changes appear on the board as it works.
          </Text>
        )}
        {items.map((it) => (
          <MessageLine key={it.id} item={it} />
        ))}
        {running && <div className="msg msg-running">…working</div>}
      </div>

      <CopilotReadout stats={stats} budget={contextBudget} />

      {/* `align="stretch"` is what the row named no `align-items` for: the textarea and the button beside
          it have always filled its height. */}
      <Stack align="stretch" className="copilot-input">
        {/* NOT a `Field`: a composer's label is its placeholder and the Send button beside it. */}
        <Control
          as="textarea"
          value={draft}
          placeholder={running ? 'Running…' : 'Message the copilot (Enter to send)'}
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
          <Button size="md" onClick={cancel}>
            Stop
          </Button>
        ) : (
          <Button variant="primary" size="md" onClick={submit} disabled={!draft.trim()}>
            Send
          </Button>
        )}
      </Stack>

      {dialog}
    </aside>
  );
}
