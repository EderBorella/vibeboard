import { describe, it, expect } from 'vitest';
import * as core from '../src/core/types.js';
import * as coreBackends from '../src/core/backends.js';
import * as web from '../web/src/shared.js';

// web/src/shared.ts hand-mirrors the server's wire contract across the tsc/Vite boundary
// (the two sides need different module resolution — see the cleanup plan, section E).
// The mirror is deliberate; silent drift is not. These assertions are the guard rail.
describe('web/shared mirrors src/core', () => {
  it('mirrors the board list and labels', () => {
    expect([...web.BOARDS]).toEqual([...core.BOARDS]);
    expect(web.BOARD_LABELS).toEqual(core.BOARD_LABELS);
  });

  it('mirrors the backend defaults', () => {
    expect(web.DEFAULT_BACKEND).toBe(coreBackends.DEFAULT_BACKEND);
    expect(web.BACKEND_DEFAULTS).toEqual(coreBackends.BACKEND_DEFAULTS);
  });

  it('resolves an unknown backend the same way on both sides', () => {
    expect(web.backendDefaults('nonsense')).toEqual(coreBackends.backendDefaults('nonsense'));
    expect(web.backendDefaults(undefined)).toEqual(coreBackends.backendDefaults(undefined));
  });
});
