import { childrenOf, liveCards } from './hierarchy.js';
import type { Card } from './types.js';

// Where the loop is, DERIVED from the board every tick (decision 39). No cursor and no field in
// autopilot-state.json: a restart needs no memory, and a second home for a fact the board carries would
// disagree with the board the moment a person dragged a card.
//
// Three things this must not do, each because leaving one out has a named failure:
//   it never reads a column to ask what happens NEXT — a column is a state the loop stamped
//     (decision 38), and the phase comes from this position plus the run records;
//   it ranks the backlog queue by (order, then id), which was the ordering the retired `featureRanks`
//     used — two orderings is two answers to "which feature is next";
//   `childrenOf` reads the PARENT's links, the same side `parentOf` reads, because a hand-edited board
//     where the two directions disagree once had two readers disagreeing about whose child a card was.

// A card the loop is in the middle of. Not read from config: `terminal` says where work ENDS, and these
// two say a card is being worked — the invariant below is about at most one of them at a time.
const OPEN = ['todo', 'in-progress'];
const QUEUE = 'backlog';

export interface Position {
  feature: Card;
  story?: Card; // absent when the feature has no story yet
  stories: Card[]; // every live product child of the feature
  tasks: Card[]; // every live engineering child of the story
}

// `{ empty: true }` is "no feature to work on" and carries NO sentence: the tick decides whether that is
// `complete`, `no-op` or `stalled`, and it has the facts to tell them apart. Answering it here would be a
// second opinion on the one thing this design has got wrong most often.
export type PositionResult = { position: Position } | { problem: string } | { empty: true };

const byQueueOrder = (a: Card, b: Card): number =>
  a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const andList = (cards: Card[]): string => {
  const ids = cards.map((c) => c.id);
  if (ids.length < 2) return ids.join('');
  return `${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]}`;
};

// A refusal rather than a tie-break, and rather than a guess (decision 39): a tie-break would silently
// pick one open card and abandon the other's work.
function twoOpen(level: 'feature' | 'story', open: Card[], of?: Card): string {
  const whose = of ? ` of ${of.id}` : '';
  return `Two ${level}s${whose} are open at once: ${andList(open)}. Auto-pilot works one ${level} at a time and derives where it is from the board, so it cannot tell which one it was in the middle of. Move one back to Backlog, or forward to Done, and start again.`;
}

const openIn = (cards: Card[]): Card[] => cards.filter((c) => OPEN.includes(c.columnSlug));

const firstQueued = (cards: Card[]): Card | undefined =>
  cards.filter((c) => c.columnSlug === QUEUE).sort(byQueueOrder)[0];

export function derivePosition(cards: Card[]): PositionResult {
  const live = liveCards(cards);
  const features = live.filter((c) => c.board === 'features');

  // THE ONE-OPEN-CARD INVARIANT, half one.
  const openFeatures = openIn(features);
  if (openFeatures.length > 1) return { problem: twoOpen('feature', openFeatures.sort(byQueueOrder)) };

  const feature = openFeatures[0] ?? firstQueued(features);
  if (feature === undefined) return { empty: true };

  const stories = childrenOf(feature, live);

  // Half two, and scoped to THIS feature: another feature's open story would stop a healthy board.
  const openStories = openIn(stories);
  if (openStories.length > 1) {
    return { problem: twoOpen('story', openStories.sort(byQueueOrder), feature) };
  }

  const story = openStories[0] ?? firstQueued(stories);
  const tasks = story ? childrenOf(story, live) : [];
  return { position: { feature, ...(story ? { story } : {}), stories, tasks } };
}
