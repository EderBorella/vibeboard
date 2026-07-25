import { describe, it, expect } from 'vitest';
import { resolveChoice, clampToCaps, isOverridden } from '../web/src/copilot/choice.js';

const claude = { backend: 'claude-code', model: 'sonnet', effort: 'low' };

describe('resolveChoice', () => {
  it('matches the server resolver on the configured default', () => {
    expect(resolveChoice(claude, {})).toEqual(claude);
  });

  it('drops the configured model when the backend is overridden', () => {
    expect(resolveChoice(claude, { backend: 'opencode' }))
      .toEqual({ backend: 'opencode', model: 'opencode/deepseek-v4-flash-free', effort: 'high' });
  });

  it('falls back entirely with no snapshot yet', () => {
    expect(resolveChoice(undefined, {}))
      .toEqual({ backend: 'claude-code', model: 'opus', effort: 'high' });
  });
});

describe('clampToCaps', () => {
  // OpenCode has no plan/acceptEdits permission split, so a Claude mode must not survive
  // the switch — the dock would render a selected button that does not exist.
  it('falls back to the backend first mode when the carried-over one does not apply', () => {
    expect(clampToCaps({ backend: 'opencode', model: 'x', effort: 'high' }, 'acceptEdits'))
      .toEqual({ mode: 'build', effort: 'high' });
  });

  it('keeps a mode and effort that the backend does support', () => {
    expect(clampToCaps({ backend: 'claude-code', model: 'opus', effort: 'xhigh' }, 'plan'))
      .toEqual({ mode: 'plan', effort: 'xhigh' });
  });

  // "xhigh" is a Claude effort; OpenCode publishes low|medium|high|max.
  it('falls back to the backend default effort when the scale differs', () => {
    expect(clampToCaps({ backend: 'opencode', model: 'x', effort: 'xhigh' }, 'build'))
      .toEqual({ mode: 'build', effort: 'high' });
  });
});

describe('isOverridden', () => {
  it('is false for an empty override and true for any set field', () => {
    expect(isOverridden({})).toBe(false);
    expect(isOverridden({ effort: 'max' })).toBe(true);
    expect(isOverridden({ backend: 'opencode' })).toBe(true);
  });
});
