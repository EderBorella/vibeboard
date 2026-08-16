import { describe, expect, it } from 'vitest';
import {
  boxCredentialPath,
  claudeCredentialFile,
  opencodeAuthFile,
} from '../src/server/boxes/copilot-env.js';
import {
  credentialCheck,
  credentialFreshness,
  opencodeAuthPresence,
} from '../src/server/boxes/credential-freshness.js';

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
// what to DO going missing, and it would not notice the clause naming WHICH backend died going missing
// either, which is the thing this pair was last changed for.
const REASON_EXPIRED =
  'the Claude Code sign-in on this machine has expired, so every agent turn would fail to authenticate. ' +
  'This project is set to the Claude Code backend; a project set to OpenCode is unaffected. ' +
  'Run "claude" in a terminal on the host to refresh it';
const REASON_SIGN_IN_AGAIN =
  'the Claude Code sign-in on this machine has expired and its refresh token has expired too, so nothing ' +
  'can renew it automatically. This project is set to the Claude Code backend; a project set to OpenCode ' +
  'is unaffected. Run "claude" in a terminal on the host and sign in again';
const REASON_NO_OPENCODE_PROVIDER =
  'this project is set to the OpenCode backend and no OpenCode provider is configured on this machine, ' +
  'so every agent turn would fail to authenticate. A project set to Claude Code is unaffected. ' +
  'Run "opencode auth login" in a terminal on the host to configure a provider';

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
    const answer = await credentialCheck({ read: r.read, now: () => DISPATCHED_AT })();
    expect(answer).toEqual({ fresh: true });
    // Asserted on the call log as well as the answer: a version that read BOTH and happened to prefer
    // the host would give the same answer today and the wrong one the day the preference is edited.
    expect(r.paths).toEqual([claudeCredentialFile()]);
    expect(claudeCredentialFile()).not.toEqual(boxCredentialPath());
  });

  // And the default direction when nobody has said. No project open, or a config not read yet, must not
  // silence a real fault — Claude Code is the default backend, so an unknown one is treated as Claude's.
  it('still refuses when the backend is unknown', async () => {
    const r = reader({ [claudeCredentialFile()]: credential({ expiresAt: EXPIRED_AT }) });
    const answer = await credentialCheck({
      read: r.read,
      now: () => HOST_AFTER_LOGIN,
      backend: () => undefined,
    })();
    expect(answer.fresh).toBe(false);
    expect(r.paths).toEqual([claudeCredentialFile()]);
  });
});

// OpenCode's credential is API KEYS AND NOTHING ELSE — measured on the machine this was written on, a
// flat map of provider entries shaped `{"<provider>":{"type":"api","key":"…"}}`, with no expiry field
// anywhere in it. So there is no clock in any of these and no fixture carries a date: the only two
// answers the file can support are "there is a provider" and "there is not". A test asserting that an
// OpenCode key had EXPIRED would be asserting on a fact the file does not contain, and the check behind
// it could never answer no — the exact defect the inode comparison was deleted for.
const OPENCODE_PATH = '/home/someone/.local/share/opencode/auth.json';
const KEY_PLACEHOLDER = 'placeholder-not-a-key';

// TWO providers, not one, because a fixture too thin cannot distinguish "counts entries" from "looks for
// one particular provider" — and the real file on the machine this was written on had two.
const OPENCODE_CONFIGURED = JSON.stringify({
  deepseek: { type: 'api', key: KEY_PLACEHOLDER },
  openrouter: { type: 'api', key: KEY_PLACEHOLDER },
});

const presence = (text: string | undefined) =>
  opencodeAuthPresence({ path: OPENCODE_PATH, read: () => text });

describe('whether OpenCode has a provider configured at all', () => {
  it('says nothing about a machine with providers in its auth file', () => {
    expect(presence(OPENCODE_CONFIGURED)).toEqual({ fresh: true });
  });

  it('refuses when there is no auth file, and says which backend and what to run', () => {
    expect(presence(undefined)).toEqual({ fresh: false, reason: REASON_NO_OPENCODE_PROVIDER });
  });

  // `opencode auth logout` leaves the file behind with nothing in it, so this is the ordinary shape of a
  // machine that HAD a provider and no longer does — not a contrived one.
  it('refuses an auth file emptied by a logout', () => {
    expect(presence('{}')).toEqual({ fresh: false, reason: REASON_NO_OPENCODE_PROVIDER });
  });

  // FAILS OPEN, unlike the missing file, and the two are asserted side by side because the difference is
  // the decision. Absent means observed-and-empty; unreadable means not observed — those bytes could be
  // the very `opencode auth login` the refusal would tell somebody to run, caught mid-write.
  it('does not invent a missing provider from bytes that are not JSON', () => {
    expect(presence('{ this is not json')).toEqual({ fresh: true });
  });

  // `typeof null` is `'object'` and so is an array's, so both would reach `Object.keys` on a value the
  // guard was not written for. `Object.keys(null)` throws, and a throw inside `liveSandbox` rejects the
  // sandbox status rather than failing open — it is not a quieter version of the same answer, it is no
  // answer at all.
  it('answers rather than throwing when the auth file is not an object', () => {
    expect(presence('null')).toEqual({ fresh: true });
    expect(presence('[]')).toEqual({ fresh: true });
    expect(presence('42')).toEqual({ fresh: true });
  });

  it('never puts a key out of the file into the sentence it shows', () => {
    const answer = presence('{}');
    expect(answer.fresh === false && answer.reason).not.toContain(KEY_PLACEHOLDER);
  });
});

// ONE CHECK, AND IT MUST ANSWER FOR THE BACKEND THE PROJECT IS SET TO. This is the reported fault: a
// person who uses only one of the two CLIs had auto-pilot stopped by the state of the other. Under S2
// the two credentials are disjoint — an OpenCode box never has Claude's mounted and a Claude box never
// has OpenCode's — so the state of one says nothing whatever about a project running the other.
describe('the check answers for the selected backend and no other', () => {
  const expiredClaude = credential({ expiresAt: EXPIRED_AT, refreshTokenExpiresAt: REFRESH_GOOD });

  // Both files present and both in the SAME reader, so each of these is a claim about which one was
  // opened as well as which answer came back — a check that read both and preferred one would give
  // today's answer and the wrong one the day the preference is edited.
  const both = () =>
    reader({
      [claudeCredentialFile()]: expiredClaude,
      [opencodeAuthFile()]: OPENCODE_CONFIGURED,
    });

  it('refuses a Claude Code project on an expired Claude token, naming Claude Code', async () => {
    const r = both();
    const answer = await credentialCheck({
      read: r.read,
      now: () => DISPATCHED_AT,
      backend: () => 'claude-code',
    })();
    expect(answer).toEqual({ fresh: false, reason: REASON_EXPIRED });
    expect(r.paths).toEqual([claudeCredentialFile()]);
  });

  // THE SAME EXPIRED TOKEN, THE SAME INSTANT, THE OTHER BACKEND. Nothing about the machine changed
  // between this test and the one above except which backend the project is set to, which is the whole
  // of the user's complaint: one CLI expiring must not stop the other's projects.
  it('does not refuse an OpenCode project on that same expired Claude token', async () => {
    const r = both();
    const answer = await credentialCheck({
      read: r.read,
      now: () => DISPATCHED_AT,
      backend: () => 'opencode',
    })();
    expect(answer).toEqual({ fresh: true });
    // It does not even open Claude's file: there is nothing in it that could matter to this project.
    expect(r.paths).toEqual([opencodeAuthFile()]);
  });

  // And the mirror image, which is the half that did not exist before: an OpenCode machine with nothing
  // configured must not be told its Claude sign-in is fine, and a Claude project must not be stopped by
  // an OpenCode machine that never had a provider.
  it('refuses an OpenCode project with no provider, naming OpenCode', async () => {
    const r = reader({
      [claudeCredentialFile()]: credential({ expiresAt: HOST_AFTER_LOGIN }),
    });
    const answer = await credentialCheck({
      read: r.read,
      now: () => DISPATCHED_AT,
      backend: () => 'opencode',
    })();
    expect(answer).toEqual({ fresh: false, reason: REASON_NO_OPENCODE_PROVIDER });
    expect(r.paths).toEqual([opencodeAuthFile()]);
  });

  it('does not refuse a Claude Code project when OpenCode has no provider', async () => {
    const r = reader({
      [claudeCredentialFile()]: credential({
        expiresAt: HOST_AFTER_LOGIN,
        refreshTokenExpiresAt: REFRESH_GOOD,
      }),
    });
    const answer = await credentialCheck({
      read: r.read,
      now: () => DISPATCHED_AT,
      backend: () => 'claude-code',
    })();
    expect(answer).toEqual({ fresh: true });
    expect(r.paths).toEqual([claudeCredentialFile()]);
  });

  // A backend string we cannot interpret is not the same as nobody having said. `undefined` gets Claude's
  // check because Claude Code is the documented default and a real fault must not be silenced; a value
  // that is neither backend would have us guessing whose credential decides, so it answers fresh and
  // reads nothing.
  it('answers fresh and opens nothing for a backend it does not recognise', async () => {
    const r = both();
    const answer = await credentialCheck({
      read: r.read,
      now: () => DISPATCHED_AT,
      backend: () => 'some-future-backend',
    })();
    expect(answer).toEqual({ fresh: true });
    expect(r.paths).toEqual([]);
  });

  // The three sentences are genuinely three. A copy-paste that made any two of them equal would satisfy
  // every assertion above, and the user would be told to run the wrong command.
  it('says something different for each of the three ways a machine can be unauthenticated', () => {
    expect(new Set([REASON_EXPIRED, REASON_SIGN_IN_AGAIN, REASON_NO_OPENCODE_PROVIDER]).size).toBe(3);
  });
});
