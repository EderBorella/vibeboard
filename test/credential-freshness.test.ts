import { describe, expect, it } from 'vitest';
import { boxCredentialPath, claudeCredentialFile } from '../src/server/boxes/copilot-env.js';
import { claudeCredentialCheck, credentialFreshness } from '../src/server/boxes/credential-freshness.js';

// The check, as a decision. It needs no daemon, no filesystem and no clock: the file read and the
// current time are both injected, and every fixture below carries PLACEHOLDER token strings — the real
// module reads two numbers out of the JSON and nothing else, and the tokens exist here only so a
// refusal that ever started quoting the file would be caught.

// The measured failure, 2026-08-16. `expiresAt` 12:35:50.578Z; runs dispatched at 12:32:46 and 12:32:50
// died with "OAuth session expired and could not be refreshed". Keeping the real epoch-ms values means
// the boundary arithmetic below is arithmetic somebody can check against the incident.
const EXPIRED_AT = 1_786_883_750_578; // 2026-08-16T12:35:50.578Z
const DISPATCHED_AT = 1_786_883_566_000; // 2026-08-16T12:32:46.000Z — 3m04s before that expiry
const HOST_AFTER_LOGIN = 1_786_915_495_073; // 2026-08-16T21:24:55.073Z, after signing in again
const REFRESH_GOOD = 1_789_339_708_073; // 2026-09-13T22:48:28.073Z
const MARGIN_MS = 5 * 60_000;

// The whole sentence, not a fragment of it. These reach the user verbatim through `agentRefusal` and the
// light's balloon, so the bytes are the behaviour — a `toContain` would not notice the clause that says
// what to DO going missing.
const REASON_EXPIRED =
  'the Claude sign-in on this machine has expired, so every agent turn would fail to authenticate. ' +
  'Run "claude" in a terminal on the host to refresh it';
const REASON_SIGN_IN_AGAIN =
  'the Claude sign-in on this machine has expired and its refresh token has expired too, so nothing can ' +
  'renew it automatically. Run "claude" in a terminal on the host and sign in again';

const TOKEN_PLACEHOLDER = 'placeholder-not-a-token';

// `undefined` fields disappear through `JSON.stringify`, which is how the "no expiresAt at all" fixture
// is built without a second shape.
function credential(fields: { expiresAt?: unknown; refreshTokenExpiresAt?: unknown }): string {
  return JSON.stringify({
    claudeAiOauth: {
      accessToken: TOKEN_PLACEHOLDER,
      refreshToken: TOKEN_PLACEHOLDER,
      expiresAt: fields.expiresAt,
      refreshTokenExpiresAt: fields.refreshTokenExpiresAt,
      scopes: ['user:inference', 'user:profile'],
      subscriptionType: 'max',
    },
  });
}

const CRED_PATH = '/home/someone/.claude/.credentials.json';

// A reader that answers from a map and records every path it was handed. The log is half the point:
// "never read the mirror" is a claim about calls, and only the log can tell it apart from a read that
// happened and agreed.
function reader(files: Record<string, string>) {
  const paths: string[] = [];
  return {
    paths,
    read: (path: string): string | undefined => {
      paths.push(path);
      return files[path];
    },
  };
}

const check = (text: string | undefined, now: number, path = CRED_PATH) =>
  credentialFreshness({ path, read: () => text, now: () => now });

describe('the sign-in this machine holds is still alive', () => {
  // THE MEASURED FAILURE. Two runs went out three minutes before the stated expiry and both died
  // unauthenticated, so "not yet expired" is not the question — "close enough to expiry that a run will
  // not survive it" is.
  it('refuses the credential that killed two runs, three minutes before its stated expiry', () => {
    const answer = check(
      credential({ expiresAt: EXPIRED_AT, refreshTokenExpiresAt: REFRESH_GOOD }),
      DISPATCHED_AT,
    );
    expect(answer).toEqual({ fresh: false, reason: REASON_EXPIRED });
  });

  it('says nothing about a credential with eight hours left on it', () => {
    const text = credential({ expiresAt: HOST_AFTER_LOGIN, refreshTokenExpiresAt: REFRESH_GOOD });
    expect(check(text, DISPATCHED_AT)).toEqual({ fresh: true });
  });

  // A dead refresh token is a different instruction to a person, not a louder version of the same one:
  // nothing will renew this in the background, so "refresh it" would be advice that cannot work.
  it('tells a person to sign in again when the refresh token is dead too', () => {
    const text = credential({ expiresAt: EXPIRED_AT, refreshTokenExpiresAt: DISPATCHED_AT - 1 });
    const answer = check(text, DISPATCHED_AT);
    expect(answer).toEqual({ fresh: false, reason: REASON_SIGN_IN_AGAIN });
    // And the two sentences really are different — a copy-paste that made them equal would otherwise
    // satisfy both of these tests.
    expect(REASON_SIGN_IN_AGAIN).not.toEqual(REASON_EXPIRED);
  });

  // A refresh token expiring in a minute is one the CLI can still spend, so it does not change the
  // sentence. Only one already in the past does.
  it('still says "refresh it" when the refresh token is close to expiry but not past', () => {
    const text = credential({ expiresAt: EXPIRED_AT, refreshTokenExpiresAt: DISPATCHED_AT + 1 });
    expect(check(text, DISPATCHED_AT)).toEqual({ fresh: false, reason: REASON_EXPIRED });
  });

  it('never puts anything out of the file into the sentence it shows', () => {
    const answer = check(credential({ expiresAt: EXPIRED_AT }), DISPATCHED_AT);
    expect(answer.fresh === false && answer.reason).not.toContain(TOKEN_PLACEHOLDER);
  });
});

// THE MARGIN IS THE POINT OF THE CHECK, so both sides of it are pinned. These use the module's own
// default rather than an injected one: the number is a decision, and a test that supplied its own would
// pass whatever the module chose.
describe('the five-minute margin', () => {
  it('is fresh one millisecond outside the margin', () => {
    const text = credential({ expiresAt: DISPATCHED_AT + MARGIN_MS + 1 });
    expect(check(text, DISPATCHED_AT)).toEqual({ fresh: true });
  });

  it('refuses exactly at the margin, because a run starting there does not outlive it', () => {
    const text = credential({ expiresAt: DISPATCHED_AT + MARGIN_MS });
    expect(check(text, DISPATCHED_AT)).toEqual({ fresh: false, reason: REASON_EXPIRED });
  });
});

// EVERY UNKNOWN ANSWERS FRESH, and each of these is a case where the alternative disables a machine that
// works. The gate's other rules fail closed because a wrong yes runs an agent unconfined; this one fails
// open because a wrong no is an outage with a fabricated cause on it, and the person cannot overrule it.
describe('what it does when it has observed nothing', () => {
  it('says nothing about a machine with no credential file at all', () => {
    expect(check(undefined, DISPATCHED_AT)).toEqual({ fresh: true });
  });

  it('does not invent an expiry from bytes that are not JSON', () => {
    expect(check('{ this is not json', DISPATCHED_AT)).toEqual({ fresh: true });
  });

  it('does not invent an expiry when the JSON has no claudeAiOauth', () => {
    expect(check(JSON.stringify({ mcpOAuth: {} }), DISPATCHED_AT)).toEqual({ fresh: true });
  });

  it('does not invent an expiry when claudeAiOauth carries no expiresAt', () => {
    expect(check(credential({ refreshTokenExpiresAt: REFRESH_GOOD }), DISPATCHED_AT)).toEqual({
      fresh: true,
    });
  });

  // A string where a number belongs is the shape changing under us, and `'0' - now` is not arithmetic we
  // want deciding whether a machine may run agents.
  it('does not invent an expiry when expiresAt is not a number', () => {
    expect(check(credential({ expiresAt: '1786883750578' }), DISPATCHED_AT)).toEqual({ fresh: true });
  });

  // Valid JSON that is not an object at all.
  it('does not invent an expiry from JSON that is not an object', () => {
    expect(check('null', DISPATCHED_AT)).toEqual({ fresh: true });
    expect(check('42', DISPATCHED_AT)).toEqual({ fresh: true });
    expect(check('[]', DISPATCHED_AT)).toEqual({ fresh: true });
  });

  // THE ONE THAT THROWS RATHER THAN ANSWERING, which is why it is separate from the case above. Every
  // other malformed shape reaches an ordinary `return`, but `typeof null` is `'object'`, so a guard that
  // tested only the type would destructure `null` and raise a TypeError — and this module is called from
  // inside `liveSandbox`, where a throw REJECTS the sandbox status instead of failing open. The whole
  // fail-open argument would be undone by the one input nobody types on purpose. Written after the guard
  // was deleted on purpose and all fifteen tests stayed green.
  it('answers rather than throwing when claudeAiOauth is null or a bare string', () => {
    expect(check(JSON.stringify({ claudeAiOauth: null }), DISPATCHED_AT)).toEqual({ fresh: true });
    expect(check(JSON.stringify({ claudeAiOauth: 'expired' }), DISPATCHED_AT)).toEqual({ fresh: true });
  });
});

describe('the clock and the file are injected, not reached for', () => {
  // An expiry that the real wall clock passed long ago, judged by an injected clock that has not reached
  // it. Only the injected one can produce `fresh`, so this fails the moment the module calls `Date.now`.
  it('judges against the injected clock, not the real one', () => {
    const text = credential({ expiresAt: Date.parse('2026-01-01T00:00:00Z') });
    expect(check(text, Date.parse('2025-12-31T00:00:00Z'))).toEqual({ fresh: true });
  });

  // THE ANTI-DEADLOCK DECISION, PINNED. `mirrorClaudeCredential()` copies host → mirror inside
  // `ensure()`, which runs before every agent turn — so a stale, expired mirror is refreshed BY a
  // dispatch. Gate on the mirror and the machine below refuses every dispatch, and the only thing that
  // could clear the refusal is the dispatch it is refusing. This is the live state of the machine the
  // check was written on: mirror expiring 12:35:50Z, host valid until 21:24:55Z.
  it('reads the host credential, so a valid host with a stale expired mirror is fresh', async () => {
    const r = reader({
      [claudeCredentialFile()]: credential({
        expiresAt: HOST_AFTER_LOGIN,
        refreshTokenExpiresAt: REFRESH_GOOD,
      }),
      [boxCredentialPath()]: credential({ expiresAt: EXPIRED_AT, refreshTokenExpiresAt: REFRESH_GOOD }),
    });
    const answer = await claudeCredentialCheck({ read: r.read, now: () => DISPATCHED_AT })();
    expect(answer).toEqual({ fresh: true });
    // Asserted on the call log as well as the answer: a version that read BOTH and happened to prefer
    // the host would give the same answer today and the wrong one the day the preference is edited.
    expect(r.paths).toEqual([claudeCredentialFile()]);
    expect(claudeCredentialFile()).not.toEqual(boxCredentialPath());
  });

  // THE OTHER FALSE REFUSAL, and it is the same mistake as the bug this module was rewritten for, just
  // pointing the other way. This credential is Claude's: under S2 an OpenCode box never has it mounted
  // and its runs authenticate from a different file entirely. Refusing an OpenCode project because a
  // Claude token expired would stop a machine for a cause that cannot reach it — and would present as
  // the product declining to work with nothing on screen explaining why.
  it('does not refuse a project whose backend is not Claude', async () => {
    const r = reader({ [claudeCredentialFile()]: credential({ expiresAt: EXPIRED_AT }) });
    const answer = await claudeCredentialCheck({
      read: r.read,
      now: () => HOST_AFTER_LOGIN,
      backend: () => 'opencode',
    })();
    expect(answer).toEqual({ fresh: true });
    // It does not even open the file: there is nothing this credential could say that would matter.
    expect(r.paths).toEqual([]);
  });

  // And the default direction when nobody has said. No project open, or a config not read yet, must not
  // silence a real fault — Claude Code is the default backend, so an unknown one is treated as Claude's.
  it('still refuses when the backend is unknown', async () => {
    const r = reader({ [claudeCredentialFile()]: credential({ expiresAt: EXPIRED_AT }) });
    const answer = await claudeCredentialCheck({
      read: r.read,
      now: () => HOST_AFTER_LOGIN,
      backend: () => undefined,
    })();
    expect(answer.fresh).toBe(false);
  });
});
