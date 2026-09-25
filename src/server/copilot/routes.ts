import type { FastifyInstance } from 'fastify';
import type { AutopilotStateName } from '../../core/autopilot-state.js';
import { type AppCtx, ensureOpen } from '../route-context.js';

// Authorising the chat copilot to use the API.
//
// ADMIN ONLY, by absence from auth.ts's scope table — which is the point of that default. An agent
// able to call this would be an agent granting itself authority, and the `assist` scope this hands
// out includes the one control-plane write in the whole system.
//
// FIX BOARD IS THE SECOND DOOR, and absent from the table for the same reason, twice over: it mints
// `repair`, the widest authority any agent holds (decision 88). It is one route rather than a sequence of
// socket verbs so the grant cannot be made on its own — there is no request that says "elevate this
// conversation", only one that makes a conversation, elevates it and starts its turn, and the turn's ending
// takes the grant back.

// Why the board cannot be handed to a repair right now, or nothing. `rebuildRefusal`'s predicates and its
// order: a running loop first, then work in flight — active and queued alike, since a queued run is a
// dispatch already decided — and then the one this door has of its own, a conversation already mid-answer.
//
// Named rather than inlined so the sentence, which is the only thing a person sees, can be asserted
// without a model anywhere near the test.
export function fixBoardRefusal(activity: {
  runs: number;
  autopilot: AutopilotStateName;
  copilotBusy: boolean;
}): string | null {
  if (activity.autopilot === 'running') {
    return 'Auto-pilot is running this project, so a repair now would race the loop for the same cards. Soft-stop it from the auto-pilot bar first, and wait for it to stop.';
  }
  if (activity.runs > 0) {
    const one = activity.runs === 1;
    return `${activity.runs} agent${one ? ' is' : 's are'} running on this project, and ${one ? 'it' : 'each'} will move ${one ? 'its' : 'a'} card when ${one ? 'it finishes' : 'they finish'} — so a repair now could be undone moments later. Wait, or stop the run${one ? '' : 's'} from the Execution dashboard.`;
  }
  if (activity.copilotBusy) {
    return 'The copilot is answering another message, and Fix board starts a conversation of its own. Wait for it to finish, or stop it from the copilot panel.';
  }
  return null;
}

export async function registerCopilotRoutes(
  api: FastifyInstance,
  ctx: AppCtx,
  // The turn itself lives with every other turn, in copilot-turns.ts. Passed in rather than rebuilt here, so
  // Fix board shares the one `repairing` flag a typed message is refused on.
  turns: { startRepair: () => Promise<{ chat: string } | { error: string }> },
): Promise<void> {
  api.post('/copilot/authority', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { enabled } = req.body as { enabled?: unknown };
    if (typeof enabled !== 'boolean') return reply.code(400).send({ error: 'Expected `enabled`.' });

    if (!enabled) {
      ctx.copilotAuthority.revoke();
      ctx.log.warn({}, 'the copilot’s API authority was withdrawn');
    } else {
      // Keyed to the conversation that is open NOW. `currentId` creates one if none exists, so the
      // credential always belongs to a chat that really is on screen.
      ctx.copilotAuthority.authorise(await ctx.chats.currentId(), ctx.session.root);
      ctx.log.warn({}, 'the copilot was authorised to use the API for this conversation');
    }
    // Every tab is told, so a second one does not show a stale button for authority it shares.
    ctx.broadcast(ctx.copilotAuthority.announcement);
    return { authorised: ctx.copilotAuthority.enabled };
  });

  api.get('/copilot/authority', async () => ({ authorised: ctx.copilotAuthority.enabled }));

  // THE WHOLE OF FIX BOARD'S SERVER SIDE. The refusals are asked here, in front of anything being created;
  // the conversation, the grant and the turn are `startRepair`'s. It answers with the conversation's id once
  // the turn is under way — the person watches the rest in the copilot panel, which every tab has already
  // been switched to by the history broadcast.
  api.post('/copilot/fix-board', async (_req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const refusal = fixBoardRefusal({
      runs: ctx.runner.activeIds.length + ctx.runner.queuedIds.length,
      autopilot: (await ctx.autopilot.current()).state,
      copilotBusy: ctx.copilot.state.running,
    });
    if (refusal) return reply.code(409).send({ error: refusal });
    const started = await turns.startRepair();
    if ('error' in started) return reply.code(409).send({ error: started.error });
    return started;
  });
}
