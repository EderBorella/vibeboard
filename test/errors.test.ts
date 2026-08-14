import { describe, expect, it } from 'vitest';
import { errorText as serverErrorText } from '../src/server/errors.js';
import { errorText as webErrorText } from '../web/src/errors.js';

// Two homes, because the two trees compile under different module resolutions. Asserted together so the
// pair cannot drift into two answers for the same throw, which is the whole reason a shared helper was
// worth having over 40 hand-written copies.
describe.each([
  ['web', webErrorText],
  ['server', serverErrorText],
])('%s errorText', (_where, errorText) => {
  it('is the message when it is an Error', () => {
    expect(errorText(new Error('the board is gone'))).toBe('the board is gone');
  });

  it('is the message for a subclass too', () => {
    expect(errorText(new TypeError('not a function'))).toBe('not a function');
  });

  // The reason this exists at all: none of these has a `.message`, and reading one off them is what
  // threw inside the handler that was reporting the first failure.
  it.each([
    ['a string', 'the connection dropped', 'the connection dropped'],
    ['a null', null, 'null'],
    ['an undefined', undefined, 'undefined'],
    ['a number', 42, '42'],
    ['a plain object', { code: 'ENOENT' }, '[object Object]'],
  ])('describes %s without throwing', (_label, thrown, expected) => {
    expect(errorText(thrown)).toBe(expected);
  });
});
