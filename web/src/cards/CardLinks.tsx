import { useState } from 'react';
import type { Card } from '../shared';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';
import { Readout } from '../ui/Readout';
import { linkedCards } from '../viewmodel';
import { LinkPicker } from './LinkPicker';

interface Props {
  card: Card;
  allCards: Card[];
  onOpenCard?: (card: Card) => void;
  onLinks?: (links: string[]) => void;
}

// The linked-card list, and the picker behind "Change". Its own component because the four
// combinations of openable/editable belong together and cost the card view its whole complexity
// budget when inlined there.
export function CardLinks({ card, allCards, onOpenCard, onLinks }: Props) {
  const [picking, setPicking] = useState(false);
  const linked = linkedCards(allCards, card.links);

  // Nothing linked and no way to link anything: not even a heading.
  if (linked.length === 0 && !onLinks) return null;

  // Captured as a const so the narrowing reaches the picker's callback: `onLinks?.()` there would
  // be a guard no caller can reach, since the picker only appears when links can be changed.
  const change = onLinks;
  const toggle = change
    ? (id: string): void =>
        change(card.links.includes(id) ? card.links.filter((l) => l !== id) : [...card.links, id])
    : undefined;

  return (
    <div className="cv-links">
      <div className="vb-label">
        Linked cards
        {onLinks && (
          <Button variant="bare" size="sm" className="cv-link-edit" onClick={() => setPicking((v) => !v)}>
            {picking ? 'Done' : 'Change'}
          </Button>
        )}
      </div>
      {picking && toggle ? (
        <LinkPicker
          linkable={allCards.filter((c) => c.id !== card.id)}
          links={card.links}
          onToggle={toggle}
        />
      ) : (
        linked.map((c) =>
          onOpenCard ? (
            <Panel
              as="button"
              variant="flat"
              key={c.id}
              className="cv-link cv-link-btn"
              data-testid="cv-link"
              title={`Open ${c.id}`}
              onClick={() => onOpenCard(c)}
            >
              <Readout size="small" tone="accent">
                {c.id}
              </Readout>
              <span className="link-title">{c.title}</span>
            </Panel>
          ) : (
            <div key={c.id} className="cv-link">
              <Readout size="small" tone="accent">
                {c.id}
              </Readout>
              <span className="link-title">{c.title}</span>
            </div>
          ),
        )
      )}
    </div>
  );
}
