import type { ReactNode } from 'react';
import { Text } from '../../atoms/Text';
import { type CardLedgerData, cancelRun, type RunRecord, resolveRun, type Skill } from '../../lib/api';
import type { Card, CardFrontmatterPatch, ProjectConfig } from '../../lib/shared';
import { useConfirm } from '../../lib/useConfirm';
import type { CardRef } from '../dock/tabs';
import { ActiveReport } from '../runs/ActiveReport';
import { CardReports } from '../runs/CardReports';
import { DispatchPane } from '../runs/DispatchPane';
import { stopRunRequest } from '../shared/requests';
import type { DispatchContext, View } from './CardsPane';
import { CardView } from './CardView';
import { RawPane } from './RawPane';

interface Props {
  card: Card | null;
  activeRef: CardRef | undefined;
  view: View;
  setView: (view: View) => void;
  config: ProjectConfig;
  live: Card[];
  runs: RunRecord[];
  // This card's ledger line, from the same response as its runs. Null until it arrives.
  account: CardLedgerData | null;
  // The record the report view is showing, resolved live by the pane.
  shown: RunRecord | undefined;
  skills: Skill[];
  editable: boolean;
  dispatch: DispatchContext;
  onOpenCard: (card: Card) => void;
  onPatch: (card: Card, patch: CardFrontmatterPatch) => void;
  onLinks: (card: Card, links: string[]) => void;
  onMove: (card: Card, columnSlug: string) => void;
  onRun: (request: import('../../lib/api').DispatchRequest) => void;
  // Refetch this card's runs and its ledger line, after a person has cleared its spent attempts. The
  // pane owns the fetch, so the ask has to travel down to the button that changed the answer.
  onForgiven: () => void;
}

// The five things the pane's body can be, and nothing else.
//
// Its own component because that is what the complexity gate actually wanted: two earlier component
// extractions and a flatten-to-if-chain each scored ZERO or worse (16 -> 16 -> 19), because the cost
// is the branching itself, not where the JSX sits. Moving the branches out of CardsPane is what paid.
// Order matters: a report whose record has vanished falls through to the card.
export function CardsBody({
  card,
  activeRef,
  view,
  setView,
  config,
  live,
  runs,
  account,
  shown,
  skills,
  editable,
  dispatch,
  onOpenCard,
  onPatch,
  onLinks,
  onMove,
  onRun,
  onForgiven,
}: Props) {
  const toCard = (): void => setView({ kind: 'card' });
  const { confirm, dialog } = useConfirm();
  let body: ReactNode;
  if (!card) {
    // Either nothing is open, or the card left the board while its tab was — deleted outside the
    // app, or its file moved. Saying so beats an empty pane that looks broken.
    body = (
      <Text role="hint" lead testId="cards-gone">
        {activeRef ? `${activeRef.id} is no longer on the board.` : 'No card open.'}
      </Text>
    );
  } else if (view.kind === 'raw') {
    body = <RawPane key={card.id} card={card} />;
  } else if (view.kind === 'dispatch') {
    body = (
      <DispatchPane
        key={`${card.id}:${view.skill.slug}:${view.previous?.run ?? ''}`}
        skill={view.skill}
        card={card}
        previous={view.previous}
        initialPrompt={view.prompt}
        defaults={dispatch.defaults}
        models={dispatch.models}
        attachable={dispatch.attachable}
        busy={dispatch.busy}
        error={dispatch.error}
        onDispatch={onRun}
        onBack={toCard}
        onBackend={dispatch.onBackend}
      />
    );
  } else if (shown) {
    body = (
      <ActiveReport
        record={shown}
        card={card}
        config={config}
        live={live}
        skills={skills}
        onOpenCard={onOpenCard}
        onMove={(columnSlug) => {
          onMove(card, columnSlug);
          toCard();
        }}
        onClose={(columnSlug) => {
          // Resolve first, then move: a move into the board's last column resolves the card's runs
          // server-side, and by then this one already is — so the record is written once whichever
          // column was picked. The pane returns to the card immediately either way.
          void resolveRun(card.board, card.id, shown.run)
            .catch(() => {})
            .finally(() => onMove(card, columnSlug));
          toCard();
        }}
        onBack={toCard}
        onContinue={(skill, prompt) => setView({ kind: 'dispatch', skill, previous: shown, prompt })}
      />
    );
  } else {
    body = (
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
          card={card}
          runs={runs}
          account={account}
          onForgiven={onForgiven}
          onOpen={(r) => setView({ kind: 'report', run: r.run })}
          onCancel={(r) => {
            void confirm(stopRunRequest(r)).then((ok) => {
              if (ok) void cancelRun(r.run).catch(() => {});
            });
          }}
        />
      </>
    );
  }

  // The dialog travels with the body: Stop is asked from the report list below, and a pane that
  // returned only `body` would leave the question with nowhere to appear.
  return (
    <>
      {body}
      {dialog}
    </>
  );
}
