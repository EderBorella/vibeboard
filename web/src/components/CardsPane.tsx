import { useState } from 'react';
import {
  cancelRun,
  type DispatchRequest,
  type InvalidSkill,
  type ModelOption,
  type RunRecord,
  type Skill,
} from '../api';
import type { CardRef } from '../dock/tabs';
import { resolveTab } from '../dock/tabs';
import { useCardRuns } from '../runs/useCardRuns';
import type { Card, CardFrontmatterPatch, ProjectConfig } from '../shared';
import { CardReports } from './CardReports';
import { CardSkills } from './CardSkills';
import { CardTabs } from './CardTabs';
import { CardView } from './CardView';
import { DispatchPane } from './DispatchPane';
import { RawPane } from './RawPane';
import { ReportPane } from './ReportPane';

// Everything the details step needs, grouped: threading eight more props through the pane would
// bury the four it has of its own.
export interface DispatchContext {
  // The project's saved selection, already resolved by the shell.
  defaults: { backend: string; model: string; effort: string };
  models: ModelOption[];
  attachable: string[];
  busy: boolean;
  error: string | null;
  // Resolves when the run is away, rejects when the server refused it — which is what returns the
  // pane to the card, or keeps it open with the error showing.
  onRun: (request: DispatchRequest) => Promise<void>;
  onBackend: (backend: string) => void;
}

interface Props {
  tabs: CardRef[];
  activeId: string | null;
  live: Card[];
  config: ProjectConfig;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  // A linked card opens as another tab, which is the browsing loop the dock exists for.
  onOpenCard: (card: Card) => void;
  onPatch: (card: Card, patch: CardFrontmatterPatch) => void;
  onLinks: (card: Card, links: string[]) => void;
  // The skill catalogue, passed straight to the rail. Fetched once by the shell rather than per
  // pane, so switching card costs no request.
  skills: Skill[];
  invalid: InvalidSkill[];
  dispatch: DispatchContext;
  // Bumped whenever the project changes on disk, which is what makes the run list live: a record is
  // written into a board folder, so the watcher already pushes a snapshot on every status change.
  trigger: unknown;
  onMove: (card: Card, columnSlug: string) => void;
}

// What the body is showing. A union rather than two booleans: Raw and a dispatch form are mutually
// exclusive, and two flags would allow a state that means nothing.
type View =
  | { kind: 'card' }
  | { kind: 'raw' }
  | { kind: 'dispatch'; skill: Skill; previous?: RunRecord; prompt?: string }
  | { kind: 'report'; run: string };

export function CardsPane({
  tabs,
  activeId,
  live,
  config,
  onFocus,
  onClose,
  onOpenCard,
  onPatch,
  onLinks,
  skills,
  invalid,
  dispatch,
  trigger,
  onMove,
}: Props) {
  const [view, setView] = useState<View>({ kind: 'card' });
  // Falls back to the first tab so a stale activeId cannot leave the pane blank. Resolved once:
  // inside the tab list it can never be absent, and repeating the optional chain there would only
  // add guards no caller can reach.
  const activeRef = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const activeTabId = activeRef?.id ?? null;
  const card = activeRef ? resolveTab(activeRef, live) : null;
  // An archived card is not in the snapshot, so a patch would land on disk with nothing to show it.
  const editable = card !== null && !card.archived;
  const toCard = (): void => setView({ kind: 'card' });
  const runs = useCardRuns(card?.board, card?.id, trigger);
  // Resolved by id rather than held as an object: the record changes on disk while the pane is open,
  // and a captured copy would keep showing 'running' after the run finished.
  const shown = view.kind === 'report' ? runs.find((r) => r.run === view.run) : undefined;

  // A dispatch that lands returns to the card, where its report will appear; one the server refused
  // keeps the form up with the reason.
  const run = (request: DispatchRequest): void => {
    void dispatch.onRun(request).then(toCard, () => {});
  };

  return (
    <div className="cards-pane">
      <CardTabs
        tabs={tabs}
        activeTabId={activeTabId}
        live={live}
        rawAvailable={card !== null}
        rawActive={view.kind === 'raw'}
        onFocus={onFocus}
        onClose={onClose}
        onToggleRaw={() => setView(view.kind === 'raw' ? { kind: 'card' } : { kind: 'raw' })}
      />

      <div className="cards-main">
        <div className="cards-body">
          {card && view.kind === 'raw' && <RawPane key={card.id} card={card} />}
          {card && view.kind === 'dispatch' && (
            <DispatchPane
              key={`${card.id}:${view.skill.slug}`}
              skill={view.skill}
              card={card}
              defaults={dispatch.defaults}
              models={dispatch.models}
              attachable={dispatch.attachable}
              busy={dispatch.busy}
              error={dispatch.error}
              onDispatch={run}
              onBack={toCard}
              onBackend={dispatch.onBackend}
            />
          )}
          {card && shown && (
            <ReportPane
              record={shown}
              card={card}
              config={config}
              createdCards={live.filter((c) => shown.created?.includes(c.id))}
              onOpenCard={onOpenCard}
              onMove={(columnSlug) => {
                onMove(card, columnSlug);
                toCard();
              }}
              onBack={toCard}
            />
          )}
          {card && view.kind === 'card' && (
            <>
              <CardView
                card={card}
                config={config}
                allCards={live}
                onOpenCard={onOpenCard}
                onPatch={editable ? (patch) => onPatch(card, patch) : undefined}
                onLinks={editable ? (links) => onLinks(card, links) : undefined}
              />
              <CardReports
                runs={runs}
                onOpen={(r) => setView({ kind: 'report', run: r.run })}
                onCancel={(r) => {
                  void cancelRun(r.run).catch(() => {});
                }}
              />
            </>
          )}
          {!card && (
            // Either nothing is open, or the card left the board while its tab was — deleted outside
            // the app, or its file moved. Saying so beats an empty pane that looks broken.
            <div className="cards-gone">
              {activeRef ? `${activeRef.id} is no longer on the board.` : 'No card open.'}
            </div>
          )}
        </div>
        {/* Actions belong to a card, so the rail goes when there is none — an empty rail would take
            width off the card for nothing. */}
        {card && (
          <CardSkills
            card={card}
            skills={skills}
            invalid={invalid}
            onRun={editable ? (skill) => setView({ kind: 'dispatch', skill }) : undefined}
          />
        )}
      </div>
    </div>
  );
}
