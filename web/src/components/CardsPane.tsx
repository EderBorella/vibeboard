import { useState } from 'react';
import type { DispatchRequest, InvalidSkill, ModelOption, Skill } from '../api';
import type { CardRef } from '../dock/tabs';
import { resolveTab } from '../dock/tabs';
import type { Card, CardFrontmatterPatch, ProjectConfig } from '../shared';
import { CardSkills } from './CardSkills';
import { CardView } from './CardView';
import { DispatchPane } from './DispatchPane';
import { RawPane } from './RawPane';

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
}

// What the body is showing. A union rather than two booleans: Raw and a dispatch form are mutually
// exclusive, and two flags would allow a state that means nothing.
type View = { kind: 'card' } | { kind: 'raw' } | { kind: 'dispatch'; skill: Skill };

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

  // A dispatch that lands returns to the card, where its report will appear; one the server refused
  // keeps the form up with the reason.
  const run = (request: DispatchRequest): void => {
    void dispatch.onRun(request).then(toCard, () => {});
  };

  return (
    <div className="cards-pane">
      <div className="cards-tabs" role="tablist">
        {tabs.map((t) => (
          <span key={t.id} className={`cards-tab${t.id === activeTabId ? ' active' : ''}`}>
            <button
              type="button"
              role="tab"
              aria-selected={t.id === activeTabId}
              className="cards-tab-label"
              onClick={() => onFocus(t.id)}
            >
              {resolveTab(t, live)?.title ?? t.id}
            </button>
            <button
              type="button"
              className="cards-tab-x"
              title={`Close ${t.id}`}
              onClick={() => onClose(t.id)}
            >
              ✕
            </button>
          </span>
        ))}
        {card && (
          <button
            type="button"
            className={`cards-raw${view.kind === 'raw' ? ' active' : ''}`}
            title="Show the card's file, frontmatter and all"
            aria-pressed={view.kind === 'raw'}
            onClick={() => setView(view.kind === 'raw' ? { kind: 'card' } : { kind: 'raw' })}
          >
            Raw
          </button>
        )}
      </div>

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
          {card && view.kind === 'card' && (
            <CardView
              card={card}
              config={config}
              allCards={live}
              onOpenCard={onOpenCard}
              onPatch={editable ? (patch) => onPatch(card, patch) : undefined}
              onLinks={editable ? (links) => onLinks(card, links) : undefined}
            />
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
