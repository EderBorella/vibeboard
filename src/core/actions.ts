import type { StopReason } from './dispatch-gate.js';
import type { PhaseName } from './phases.js';
import type { Card } from './types.js';

// The vocabulary the tick speaks and the service carries out. FOUR members: a block is a `stamp` to the
// blocked column and the bootstrap is a `dispatch` with no card, so neither needs a member of its own.
//
// Its own module, and that is a dependency decision: both the lifecycle machine and the loop that carries
// its actions out depend on this type, so declaring it inside `tick.ts` would make every consumer import
// the module whose logic changes most. `core/lifecycle/tick.ts` and `service/act/index.ts` import it, and
// `tick.ts` re-exports it rather than declaring a union of its own — which is what stops the vocabulary
// and the machine drifting apart.
export type TickAction =
  | { kind: 'stop'; reason: StopReason; detail?: string }
  | {
      kind: 'dispatch';
      phase: PhaseName;
      skill: string;
      card?: Card;
      previous?: string;
      group?: Group;
      judged?: Judged;
    }
  | { kind: 'stamp'; phase: PhaseName; card: Card; to: string; why: string }
  | { kind: 'wait' }; // as much is in flight as the config allows

// THE CARDS ONE LEVEL DOWN THAT A DISPATCH DELIVERS (decision 83): a story's implement and its tasks, and
// since decision 87 its fix and the tasks a send-back re-opened. Absent everywhere else, and an absent group
// means the run is about its own card and nothing else.
//
// BOTH COLUMNS COME FROM THE TICK, not from the executor. Which column means "being worked" and which means
// "delivered" is a decision about the machine, and the executor holds no decisions of its own — so the pure
// side names them and the service does the writing.
export interface Group {
  // In queue order. An implement's is never more than the tick's ceiling — which bounds what the run is TOLD
  // to do and what is delivered for it, not what it can see: the prompt lists every card the story links to,
  // file path included (`resolveDispatch` in server/runs/routes.ts filters nothing), so a sixth task is in
  // front of the agent and what says it is a later run's is its COLUMN plus the sentence the skill is seeded
  // with. A fix's is every task the send-back re-opened, because what the fix is asked for is the finding.
  cards: Card[];
  // Stamped before the dispatch, and it is how the run is TOLD which cards are its own — the board is the
  // only channel there is, the prompt naming every linked card with the column it stands in.
  entry: string;
  // Stamped TOGETHER when the run completes, so a partial stamp cannot leave a story half-judgeable. NOT
  // finished: a run's own ending is the agent's word about itself (decision 40), and only the story's
  // judgement moves a task on from here (`Judged`).
  delivered: string;
}

// THE TASKS A STORY'S JUDGEMENT DECIDES (decision 87), carried on its dispatch: the ones standing delivered,
// and where its verdict sends them. A task reaches `done` only when a passing review writes it there, which
// is what makes the column mean judged; a send-back re-opens them, so the fix after it has real work to
// deliver and the board says so. The tick names both columns for the reason it names `Group`'s.
export interface Judged {
  cards: Card[];
  // A terminal column: judged, and passed.
  passed: string;
  // Where a task stands while it is being worked, which is what a sent-back task is again.
  sentBack: string;
}
