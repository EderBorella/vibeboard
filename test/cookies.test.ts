import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  attachCookies,
  CREDENTIAL_COOKIE,
  clearedCookies,
  credentialCookies,
  HINT_COOKIE,
  readCookie,
  serialiseCookie,
} from '../src/server/auth/cookies.js';

// The two ten-line functions the whole transport rests on, asserted directly rather than through a
// route — an attribute that is silently wrong makes sign-in look like it worked and every request
// after it fail, which is not a shape a route test reads clearly.

describe('the attributes on the credential cookie', () => {
  const [credential, hint] = credentialCookies('dev_abc.the-secret-half');

  // G6, and the exact bytes rather than four substring checks: these attributes ARE the behaviour, and
  // a `toContain` passes on a cookie that also carries something it should not.
  it('is HttpOnly, SameSite=Strict, and scoped to the whole app', () => {
    expect(credential).toBe(
      'vb=dev_abc.the-secret-half; Path=/; SameSite=Strict; Max-Age=31536000; HttpOnly',
    );
  });

  // NOT `Secure`, deliberately. The board is served over plain HTTP on a LAN, so `Secure` would stop
  // the browser sending the cookie at all: the sign-in would appear to succeed and everything after it
  // would 401. It looks like an omission, which is why it is asserted.
  it('is not Secure', () => {
    expect(credential).not.toContain('Secure');
  });

  // The hint carries no secret and MUST be readable by page JS — it is the only thing that lets the
  // client answer "am I signed in?" without a round trip in front of the first render.
  it('sets a readable hint that carries no credential', () => {
    expect(hint).toBe('vb.in=1; Path=/; SameSite=Strict; Max-Age=31536000');
    expect(hint).not.toContain('HttpOnly');
    expect(hint).not.toContain('the-secret-half');
  });

  it('names the credential cookie and the hint differently enough to parse apart', () => {
    // `vb` is a prefix of `vb.in`, so a parser that matched by prefix would read the hint as the
    // credential. readCookie matches the whole name; this pins the premise.
    expect(HINT_COOKIE.startsWith(CREDENTIAL_COOKIE)).toBe(true);
    expect(readCookie('vb.in=1', CREDENTIAL_COOKIE)).toBe('');
  });
});

describe('clearing them', () => {
  // G7's other half. Clearing only one leaves a browser that either believes in a credential the server
  // has forgotten, or holds one it does not know it has — and the second is the state that poisoned the
  // host for a minute at a time.
  it('clears both, with an expiry as well as a zero Max-Age', () => {
    expect(clearedCookies()).toEqual([
      'vb=; Path=/; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly',
      'vb.in=; Path=/; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    ]);
  });
});

describe('reading one back', () => {
  it('finds a name among others', () => {
    expect(readCookie('a=1; vb=the-credential; z=9', 'vb')).toBe('the-credential');
  });

  it('tolerates the spacing a browser actually sends', () => {
    expect(readCookie('a=1;vb=x;  z=9', 'vb')).toBe('x');
  });

  // Splitting on every `=` truncates a value to something unrecognisable, and the failure is a 401
  // rather than a parse error — so it would be blamed on the credential.
  it('keeps a value containing an equals sign whole', () => {
    expect(readCookie('vb=abc==', 'vb')).toBe('abc==');
  });

  it('does not match a name that merely starts or ends the same', () => {
    expect(readCookie('vb.in=1; xvb=y', 'vb')).toBe('');
  });

  it('answers empty for an absent header rather than throwing', () => {
    expect(readCookie(undefined, 'vb')).toBe('');
    expect(readCookie('', 'vb')).toBe('');
    expect(readCookie('malformed', 'vb')).toBe('');
  });

  // A value of '' is what a cleared cookie looks like on the way back before the browser drops it, and
  // it must never authenticate: credentials.verify refuses '' too, but two guards is the point.
  it('reads a cleared cookie as empty', () => {
    expect(readCookie('vb=; other=1', 'vb')).toBe('');
  });
});

describe('attaching them to a reply', () => {
  it('adds one header per cookie rather than one joined value', () => {
    const added: string[] = [];
    attachCookies({ header: (name, value) => added.push(`${name}: ${value}`) }, ['a=1', 'b=2']);
    expect(added).toEqual(['set-cookie: a=1', 'set-cookie: b=2']);
  });
});

describe('the name the client mirrors', () => {
  // web/ is a separate tsc project and cannot import from src/, so the hint's name is written down in
  // both. A mirror nobody checks is a mirror that drifts — and this one drifting means a browser that
  // signs in and then believes it did not, for ever.
  it('is the same string in web/src/token.ts', () => {
    const client = readFileSync(new URL('../web/src/token.ts', import.meta.url), 'utf8');
    expect(client).toContain(`const HINT_COOKIE = '${HINT_COOKIE}';`);
  });
});

describe('serialiseCookie itself', () => {
  it('leaves off HttpOnly unless asked', () => {
    expect(serialiseCookie('x', 'y')).toBe('x=y; Path=/; SameSite=Strict; Max-Age=31536000');
  });
});
