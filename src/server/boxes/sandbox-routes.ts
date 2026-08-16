import type { FastifyInstance } from 'fastify';
import { consecutiveInfrastructureFailures } from '../../core/accounting.js';
import { listRuns } from '../../store/run-store.js';
import type { AppCtx } from '../route-context.js';
import { attachedOpencodeUrl, restartOpencodeServer, takeOverOpencodeServer } from './opencode-server.js';
import { agentRefusal } from './sandbox.js';

// What is enforced, and the two ways to change it. Its own module rather than a corner of
// control.ts, which is the file controller for documents that steer the models — a different
// concern that happens to share the word "control".
//
// All three are admin-only, and they are so by ABSENCE: a route missing from the scope table in
// auth.ts is admin-only, so an agent reaching any of these gets a 403 without anyone having to
// remember to deny it. A run restarting the server it is running inside is not an authority it has
// any business holding.

// WHAT ALREADY WENT WRONG, from the loop's own records — and it gates NOTHING.
//
// The failure this answers: auto-pilot stopped on a dead sign-in with "2 runs in a row failed before
// reaching a model: Failed to authenticate: OAuth session expired", and the top-bar light went on saying
// `online` throughout, because every field beside it answers "may an agent start" and the answer to that
// was still yes. The user's account of the morning is that the project state "continued to be online as
// if everything was fine".
//
// DERIVED FROM THE RUN RECORDS RATHER THAN FROM A FRESH PROBE, which is what makes it impossible for the
// light to disagree with the loop: `consecutiveInfrastructureFailures` returns the exact records
// `machineBroken` in core/lifecycle/tick.ts read when it stopped, so the light needs nothing to be true
// that the loop did not already observe. A second probe would be a second opinion about whether the
// machine works, and two of those diverged in this codebase once already.
//
// NO `since`, deliberately — and the omission is the whole reason this is safe. `since` exists to stop
// the streak deadlocking the loop it protects: the streak is read off the END of the history and can only
// be broken by a run that reached a model, so without the auto-pilot-start boundary the very first tick
// after a fix would stop again on the same records, for ever. That boundary belongs to a DECISION about
// dispatching. This is a REPORT about what happened, it refuses nothing, and a light that forgot the
// failures the moment Start was pressed would go green over a machine nobody had fixed.
async function recentFailure(root: string): Promise<{ runs: number; note: string; at: string } | undefined> {
  const streak = consecutiveInfrastructureFailures(await listRuns(root));
  // Counted back from the end of the history, so the first element is the most recent one.
  const latest = streak[0];
  if (!latest) return undefined;
  return {
    runs: streak.length,
    // The record's own sentence, never reworded here: a dead credential and a working directory that no
    // longer exists read identically once the specifics are dropped, and they need different fixes.
    //
    // The fallback states the same fact `machineBrokenSentence` falls back to (core/lifecycle/stop-sentences.ts)
    // rather than copying its words, because that one is a clause mid-sentence and this one is a paragraph on
    // its own. A note is what the runner writes when there is no report to speak for the run, so a record
    // without one was classified somewhere that had nothing to say — rare, and no reason to lose the report.
    note: latest.note ?? 'The run left nothing behind that says why, beyond never having reached a model.',
    at: latest.started,
  };
}

export async function registerSandboxRoutes(api: FastifyInstance, ctx: AppCtx): Promise<void> {
  api.get('/sandbox', async () => {
    const attached = attachedOpencodeUrl();
    // Re-probed per request, not read from a value captured at startup. The whole point of this
    // endpoint is to answer "can this project run anything RIGHT NOW", and it used to answer
    // "could it, when the server booted" — which stayed `ok: true` after the image was deleted.
    const sandbox = await ctx.sandbox();
    // Nothing to report with no project open: the run records live under a project root, and there is
    // no root. Every other field here is about docker and the backend, which are answerable either way.
    const root = ctx.session.root;
    const failing = root ? await recentFailure(root) : undefined;
    // WHICH cause, so the UI can title the refusal without reading the sentence for keywords. Derived
    // from exactly the two facts `agentRefusal` derives from, in exactly its order, which is what makes
    // it null in exactly the cases the refusal is null — a relationship the route test asserts rather
    // than trusts, because the two are computed by different expressions and could drift apart.
    const refusalKind = attached ? ('attached' as const) : sandbox.ok ? null : sandbox.kind;
    return {
      ok: sandbox.ok,
      // The image, where this used to be the AppArmor profile name. Same job — name the thing that
      // is doing the confining, so the UI can show it and a person can check it.
      profile: sandbox.ok ? sandbox.image : undefined,
      reason: sandbox.ok ? undefined : sandbox.reason,
      // Reported even when the sandbox is fine, because it is the other half of whether auto-pilot
      // may start — and the UI shows a different action for each.
      backend: attached ? ('attached' as const) : ('managed' as const),
      attachedUrl: attached,
      // Computed here, once, so the UI never has to re-derive the rule and drift from the loop.
      // The same gate dispatch uses, not a second opinion about it.
      agentRefusal: agentRefusal(sandbox, attached),
      refusalKind,
      // Beside them and not among them: `ok`, `agentRefusal` and `refusalKind` are untouched by this, so
      // a project whose last runs died on infrastructure can still dispatch. Absent rather than null when
      // the last runs were healthy, matching the field's optionality on the wire.
      ...(failing ? { recentFailure: failing } : {}),
    };
  });

  api.post('/opencode/restart', async (req) => {
    const url = await restartOpencodeServer();
    req.log.info({ url }, 'opencode server restarted');
    return { ok: true, url };
  });

  api.post('/opencode/takeover', async (req) => {
    const previous = attachedOpencodeUrl();
    const url = await takeOverOpencodeServer();
    req.log.info({ previous, url }, 'took over from an external opencode server');
    return { ok: true, url };
  });
}
