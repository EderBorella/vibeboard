import type { RunRecord } from '../../lib/api';
import type { Card } from '../../lib/shared';
import type { ConfirmRequest } from '../../lib/useConfirm';

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

// Signing another browser out. Named by its label rather than its id, because the label is what the
// user recognises — and it is the only thing they have to go on.
export function revokeDeviceRequest(label: string): ConfirmRequest {
  return {
    title: 'Sign this browser out?',
    body: `${label} loses access immediately, and anything it has open stops working. It can sign in again by asking, and you would have to allow it.`,
    action: 'Sign it out',
    danger: true,
  };
}

// Signs out every browser INCLUDING this one, which is the half people do not expect — so it is the
// first thing the body says.
export function signOutEverythingRequest(count: number): ConfirmRequest {
  const others = count > 1 ? ` and ${count - 1} other${count > 2 ? 's' : ''}` : '';
  return {
    title: 'Sign every browser out?',
    body: `This browser${others} loses access immediately, and you will be signed in again on the next page load — on this machine only. Use this if you think somebody else has seen this board's credential.`,
    action: 'Sign everything out',
    danger: true,
  };
}

// FIX BOARD. What it grants is the half a person must hear before pressing: a copilot conversation with powers
// over the board that the Authorise button never gives — clearing attempts, reordering — and that it lasts one
// answer. What it cannot do is said too, because "elevated" with no edge reads as "everything".
export function fixBoardRequest(): ConfirmRequest {
  return {
    title: 'Hand this board to the copilot to repair?',
    body: 'It opens a new copilot conversation with elevated powers over this board: beyond creating, editing, moving and archiving cards, it may clear cards’ spent attempts, reorder cards and restore archived ones. The powers last for its one answer, which ends with a short report of what it changed. It cannot start auto-pilot, change settings or touch the foundation documents. You can watch it work in the copilot panel.',
    action: 'Fix board',
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
