import type { RunRecord } from '../api';
import type { Card } from '../shared';
import type { ConfirmRequest } from './useConfirm';

// Questions asked from more than one place, so the wording cannot drift between them. Pure functions
// returning the request — the asking is the caller's, the words are here.

// Stopping is offered on the card's report row and on the Execution dashboard. What it costs is the
// work the agent has not written down yet: the report is the only thing that survives a run, so an
// agent killed before writing one leaves nothing but its transcript.
export function stopRunRequest(record: RunRecord): ConfirmRequest {
  return {
    title: `Stop the ${record.skill} run?`,
    body: `The agent working on ${record.card} is killed. Anything it has not already written to its report is lost, and what it has spent is spent.`,
    action: 'Stop the run',
    danger: true,
  };
}

// Archiving is reversible, and the copy says so rather than borrowing the weight of a deletion —
// `danger` is deliberately absent. It is guarded at all because it is a one-click ✕ on every tile.
export function archiveCardRequest(card: Card): ConfirmRequest {
  return {
    title: `Archive ${card.id}?`,
    body: `“${card.title}” leaves the board. You can restore it from the archive drawer.`,
    action: 'Archive',
  };
}

// The emergency stop. Everything in the project dies — every agent, the backend server, and the loop
// itself — and the project stays halted until someone restarts it, so the chat and manual runs stop
// working too. That last part is the half people do not expect, which is why it is in the body.
export function killProjectRequest(): ConfirmRequest {
  return {
    title: 'Kill everything in this project?',
    body: 'Every agent working on this project is killed, and anything not already written to a report is lost. The project is then halted: the chat and manual runs will not work either until you restart it.',
    action: 'Kill everything',
    danger: true,
  };
}
