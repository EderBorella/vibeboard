import { byQueueOrder } from './board/ordering.js';
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

// WHICH FEATURE, and it is the ONE thing focus changes. Everything below this — the stories, the open-story
// invariant, the tasks — runs exactly as it does unfocused, over the children of whichever feature this
// returns.
//
// UNDER FOCUS THE TWO-OPEN-FEATURE REFUSAL DOES NOT APPLY, and that is the point rather than an omission.
// It exists because the loop cannot tell which of two open features it was in the middle of; a person naming
// one has answered exactly that question, and refusing anyway would make the focus useless in the state it
// is most wanted.
//
// `liveCards` HAS ALREADY RUN on what is passed here, so an ARCHIVED feature is absent and reads as "no
// longer on the board" — which is what archiving means. The loop must not carry on working a card somebody
// filed away.
function featureFor(features: Card[], focus: string | undefined): Card | { problem: string } | undefined {
  if (focus === undefined) {
    // THE ONE-OPEN-CARD INVARIANT, half one.
    const open = openIn(features);
    if (open.length > 1) return { problem: twoOpen('feature', open.sort(byQueueOrder)) };
    return open[0] ?? firstQueued(features);
  }
  const card = features.find((c) => c.id === focus);
  // A REFUSAL RATHER THAN A FALLBACK, and this is the whole care of the feature. Quietly picking the next
  // feature instead is how you focus F-002, walk away, and come back to find the loop three cards deep in
  // F-005 — work nobody asked for, on a card nobody chose, reported as an ordinary run.
  if (!card) {
    return {
      problem: `Auto-pilot is focused on ${focus}, and there is no such feature on the board any more — it was archived, deleted, or its id changed. Choose another feature to focus on, or clear the focus, and start again.`,
    };
  }
  // AND A FOCUSED FEATURE THAT IS FINISHED READS AS `empty`, exactly as an unfocused one does. `openIn` and
  // `firstQueued` never pick a card out of `done` above, so returning one here on the strength of its id
  // would make focus the one way to re-enter a closed feature — and the loop would work it again for ever.
  // Asked with this file's own vocabulary rather than `isSettled`, because `derivePosition` reads no config
  // and giving it one would be a second answer to "which columns mean finished".
  if (!OPEN.includes(card.columnSlug) && card.columnSlug !== QUEUE) return undefined;
  return card;
}

export function derivePosition(cards: Card[], focus?: string): PositionResult {
  const live = liveCards(cards);
  const features = live.filter((c) => c.board === 'features');

  const feature = featureFor(features, focus);
  if (feature !== undefined && 'problem' in feature) return feature;
  // A FOCUSED FEATURE THAT IS FINISHED IS `empty`, not a problem: the tick decides whether that means
  // `complete` or something else, and it has the facts to tell them apart. Unfocused, this is the empty
  // board; focused, it is the one feature having been seen through — which is the whole ask.
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
