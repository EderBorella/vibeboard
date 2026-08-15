import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  archiveCard,
  cancelRun,
  createCard,
  getState,
  patchCard,
  placeCard,
  resolveRunRecord,
  setLinks,
} from '../api';
import { AutopilotBar } from '../autopilot/AutopilotBar';
import { HaltOverlay } from '../autopilot/HaltOverlay';
import { archiveCardRequest, stopRunRequest } from '../confirm/requests';
import { useConfirm } from '../confirm/useConfirm';
import { type CopilotMode, useCopilot } from '../copilot/useCopilot';
import { useCardTabs } from '../dock/useCardTabs';
import { useDock } from '../dock/useDock';
import { useDispatch } from '../runs/useDispatch';
import { useRuns } from '../runs/useRuns';
import { needsAttention } from '../runs/viewmodel';
import { SettingsModal } from '../settings/SettingsModal';
import { BOARDS, type BoardName, type Card, type CardFrontmatterPatch } from '../shared';
import { ApprovalPrompt } from '../signin/ApprovalPrompt';
import { SignIn } from '../signin/SignIn';
import { useSkills } from '../skills/useSkills';
import { useAutopilot } from '../useAutopilot';
import { useCopilotChoice } from '../useCopilotChoice';
import { useCollapsedBoards, useTheme } from '../useLocalPrefs';
import { usePendingSignins } from '../usePendingSignins';
import { useSandbox } from '../useSandbox';
import { useSignin } from '../useSignin';
import { useSnapshot } from '../useSnapshot';
import { canPlace, presentTags, tagCounts, toggleTag } from '../viewmodel';
import { lightFor, lightTitle } from './connection-light';
import { ProjectGate } from './ProjectGate';
import { chooseContent, rebindOnSignIn } from './shell';
import { type MainTab, TopBar } from './TopBar';
import { WorkArea } from './WorkArea';

export function App() {
  const [bump, setBump] = useState(0);
  const [showGate, setShowGate] = useState(false);
  const [ready, setReady] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tab, setTab] = useState<MainTab>('boards');
  // Asked before anything irreversible. `dialog` is rendered at the bottom of the shell, above
  // everything else — see useConfirm.
  const { confirm, dialog } = useConfirm();
  // Tag filter: one filter across all three boards, and deliberately NOT persisted — a filter
  // restored on the next load reads as cards having gone missing.
  const [activeTags, setActiveTags] = useState<string[]>([]);
  // Open cards, one dock tab each. The state lives in its own hook so it is testable without
  // mounting the shell — see dock/useCardTabs.ts.
  const cards = useCardTabs();
  const dock = useDock();
  const dragged = useRef<Card | null>(null);
  // Signing in comes before everything: with no credential the project gate is a lie — every button on
  // it fails — and that WAS the bug. Silent on the first ever visit; a wait for approval after that.
  const signin = useSignin();
  const pendingSignins = usePendingSignins(bump);
  const { snapshot, conn } = useSnapshot(bump);
  // Whether the project can run anything at all. Fetched HERE rather than in the settings dialog it
  // used to be reachable from: a missing dependency disables every agent and the copilot, and hiding
  // that two clicks deep meant the first symptom was a refusal at the moment you tried to work.
  const { sandbox } = useSandbox(bump, signin.signedIn);
  const light = lightFor(conn, sandbox?.agentRefusal);
  // Auto-pilot's state: the chip in the bar, and the overlay when the project is halted. From the
  // endpoint on mount and from the socket after that, so a kill in another tab raises the overlay here.
  const autopilot = useAutopilot(bump, signin.signedIn);

  // Copilot state lives here (not in the panel) so the transcript + socket survive
  // closing/reopening the dock. The server-side session persists regardless.
  const copilot = useCopilot(bump);
  // Mode is per-turn and deliberately NOT persisted — you pick it for the task at hand.
  const [copilotMode, setCopilotMode] = useState<CopilotMode>('bypassPermissions');

  // Backend/model/effort: the config holds the defaults, the dock holds a session override.
  const {
    choice,
    overridden,
    setModel,
    setEffort,
    setBackend,
    reset: onResetCopilot,
  } = useCopilotChoice(snapshot?.config.copilot);

  const [theme, setTheme] = useTheme();
  const [collapsed, toggleBoard] = useCollapsedBoards();
  // Refetched on every snapshot, so a SKILL.md written by the user or an agent reaches the rail
  // without a reload.
  const catalogue = useSkills(snapshot, signin.signedIn);
  // Everything the details step needs. `choice.backend` drives the model list, so switching
  // connector in the form reloads it exactly as it does in the copilot dock.
  const dispatch = useDispatch(choice.backend, snapshot, signin.signedIn);
  // Every run in the project, for the Execution tab and its badge.
  const allRuns = useRuns(snapshot, signin.signedIn);

  const allCards = snapshot ? BOARDS.flatMap((b) => snapshot.boards[b] ?? []) : [];
  // Chips come from every card, not the filtered set, so the bar does not shrink out from under
  // the pointer as you narrow — the counts stay absolute for the same reason.
  const tags = tagCounts(allCards);
  const active = presentTags(activeTags, tags);

  // Creating a card writes it straight away and docks it, with the title ready to type over.
  // There is no create dialog: every field is editable in the pane, so a form would only be a
  // second way to do the same thing.
  const onAdd = (board: BoardName, columnSlug: string): void => {
    void createCard({ board, columnSlug, title: 'Untitled' }).then(onOpen);
  };
  const onPatch = (card: Card, patch: CardFrontmatterPatch): void => {
    void patchCard(card.board, card.id, patch);
  };
  const onLinks = (card: Card, links: string[]): void => {
    void setLinks(card.board, card.id, links);
  };
  // Opening a card docks it instead of covering the app with a modal, so the boards, the copilot
  // and the card stay usable together. Editing is still the modal, reached from the pane.
  const onOpen = (card: Card): void => {
    cards.open(card, allCards);
    dock.show('cards'); // unfolds the dock too, or the card opens out of sight
  };
  const onDragStart = (card: Card): void => {
    dragged.current = card;
  };
  // Reversible, and the copy says so — but it is a one-click ✕ on every tile, which makes it the
  // easiest thing here to do by accident.
  const onArchive = (card: Card): void => {
    void confirm(archiveCardRequest(card)).then((ok) => {
      if (ok) void archiveCard(card.board, card.id);
    });
  };
  const onTag = (tag: string): void => setActiveTags((prev) => toggleTag(prev, tag));
  // Moving a card after a successful run is the user's click, never something the run does: 'Review'
  // does not exist on every board, and a wrong automatic move is worse than none.
  const onMoveCard = (card: Card, columnSlug: string): void => {
    void placeCard(card.board, card.id, columnSlug, null);
  };
  // Start a fresh chat on a backend switch, since a session belongs to the backend that
  // created it. Coordinating that is the shell's job; useCopilotChoice owns the override state.
  const onBackend = (backend: string): void => {
    if (backend === choice.backend) return;
    copilot.newSession();
    setBackend(backend);
  };
  // Position the dragged card: reorder within its column, or move it into another one.
  // beforeId is the card to land in front of; null means the end of the column.
  const onDrop = (board: BoardName, columnSlug: string, beforeId: string | null): void => {
    const card = dragged.current;
    dragged.current = null;
    if (!canPlace(card, board, beforeId)) return;
    void placeCard(card.board, card.id, columnSlug, beforeId);
  };

  // Waits for a credential: unauthenticated, this call 401s, and the answer would be read as "no
  // project open" — which is how the gate came to be shown to a browser that could not use it.
  useEffect(() => {
    if (!signin.signedIn) return;
    setReady(false);
    getState()
      .then((s) => setShowGate(!s.open))
      .catch(() => setShowGate(true))
      .finally(() => setReady(true));
  }, [signin.signedIn]);

  // EVERY OTHER FETCH AND THE SOCKET ARE KEYED ON `bump`, so signing in re-runs all of them at once.
  //
  // Without this, a browser that signed itself in silently kept whatever those hooks got while it had
  // no credential: five of them fetch on mount, each answered 401, and none of them is keyed on
  // anything that changes afterwards — so the auto-pilot chip, the skills rail, the run list and the
  // model list stayed empty until a manual reload, and the socket, which declines to open without a
  // credential, never opened at all.
  //
  // On the transition only, tracked with a ref: a browser that arrives already holding a credential
  // must not throw away the socket it just opened.
  const wasSignedIn = useRef(signin.signedIn);
  useEffect(() => {
    if (rebindOnSignIn(signin.signedIn, wasSignedIn.current)) setBump((b) => b + 1);
    wasSignedIn.current = signin.signedIn;
  }, [signin.signedIn]);

  // A newly-opened/scaffolded project: reconnect the socket so it receives the snapshot
  // of the now-open project (the server pushes a snapshot on connect when a project is open).
  function onOpened(): void {
    setShowGate(false);
    setBump((b) => b + 1);
    cards.clear(); // the open tabs all belong to the project being left
  }

  // The dock's occupants. Cards is the only one today; a terminal would be one more entry here
  // and one more component, with no change to UtilityDock.
  // A flat chain rather than nested ternaries in the JSX: same four outcomes, and cognitive
  // complexity counts nesting far more heavily than sequence.
  // The ORDER lives in ./shell as a pure function, because getting it wrong is the bug this feature
  // fixes — with no credential the project gate is a screen whose every button fails.
  const which = chooseContent({
    signedIn: signin.signedIn,
    ready,
    showGate,
    hasSnapshot: Boolean(snapshot),
  });
  let content: ReactNode;
  if (which === 'signin') content = <SignIn phase={signin.phase} onRetry={signin.retry} />;
  else if (which === 'loading') content = <div className="empty">Loading…</div>;
  else if (which === 'gate') content = <ProjectGate onOpened={onOpened} />;
  else if (which === 'empty' || !snapshot)
    content = <div className="empty">{conn === 'open' ? 'No project open.' : 'Connecting…'}</div>;
  else
    content = (
      <WorkArea
        snapshot={snapshot}
        tab={tab}
        bump={bump}
        allCards={allCards}
        runs={allRuns}
        skills={catalogue}
        cards={cards}
        dock={dock}
        copilot={{
          state: copilot,
          open: copilotOpen,
          mode: copilotMode,
          choice,
          overridden,
          onMode: setCopilotMode,
          onModel: setModel,
          onEffort: setEffort,
          onBackend,
          onReset: onResetCopilot,
          onClose: () => setCopilotOpen(false),
        }}
        dispatch={dispatch}
        boards={{
          tags,
          activeTags: active,
          collapsed,
          onToggleBoard: toggleBoard,
          onTag,
          onClearTags: () => setActiveTags([]),
        }}
        onAdd={onAdd}
        onOpen={onOpen}
        onArchive={onArchive}
        onDragStart={onDragStart}
        onDrop={onDrop}
        onPatch={onPatch}
        onLinks={onLinks}
        onMoveCard={onMoveCard}
        onCancelRun={(record) => {
          void confirm(stopRunRequest(record)).then((ok) => {
            if (ok) void cancelRun(record.run).catch(() => {});
          });
        }}
        onResolveRun={(record) => {
          void resolveRunRecord(record).catch(() => {});
        }}
      />
    );

  return (
    <div className="app-shell">
      <TopBar
        attentionCount={allRuns.runs.filter(needsAttention).length}
        showProject={Boolean(snapshot) && !showGate && signin.signedIn}
        projectName={snapshot?.name}
        tab={tab}
        onTab={setTab}
        theme={theme}
        onTheme={setTheme}
        copilotOpen={copilotOpen}
        onToggleCopilot={() => setCopilotOpen((v) => !v)}
        onSettings={() => setSettingsOpen(true)}
        onSwitchProject={() => setShowGate(true)}
        autopilot={autopilot.state}
        light={light}
        lightTitle={lightTitle(light, sandbox?.agentRefusal)}
        agentRefusal={sandbox?.agentRefusal}
        refusalKind={sandbox?.refusalKind}
      />

      {/* Stacked under the header, only with a project open: transport for the thing the whole app is
          for. "Hit play and see it move" used to mean four clicks into a settings modal. */}
      {which === 'work' && snapshot && (
        <AutopilotBar
          state={autopilot.state}
          runs={allRuns}
          bump={bump}
          onChanged={autopilot.refresh}
          onSettings={() => setSettingsOpen(true)}
        />
      )}

      {content}

      {settingsOpen && snapshot && (
        <SettingsModal
          config={snapshot.config}
          onClose={() => setSettingsOpen(false)}
          onSaved={() => setSettingsOpen(false)}
          autopilot={autopilot.state}
          onAutopilotChanged={autopilot.refresh}
          confirm={confirm}
        />
      )}

      {/* Last in the shell and above everything, like the confirm dialog: a halted project is not a
          state anything else in here should be reachable through. Only once a project is open — the
          gate has nothing to halt. */}
      {autopilot.state?.state === 'halted' && !showGate && (
        <HaltOverlay state={autopilot.state} onRestarted={autopilot.refresh} />
      )}

      {/* Above the halt overlay, and above everything else: a browser asking to be let in is the one
          decision that has to be answerable from whatever state this tab happens to be in — including
          a halted project, which is exactly when someone is trying to get a second device onto the
          board to look at it. */}
      {signin.signedIn && pendingSignins.length > 0 && <ApprovalPrompt pending={pendingSignins} />}

      {dialog}
    </div>
  );
}
