import { describe, expect, it } from 'vitest';
import { clampToCaps, isOverridden, resolveChoice } from '../web/src/copilot/choice.js';

const configured = {
  backend: 'claude-code',
  backends: {
    'claude-code': { model: 'sonnet', effort: 'low' },
    opencode: { model: 'opencode/big-pickle', effort: 'max' },
  },
};
const selected = { backend: 'claude-code', model: 'sonnet', effort: 'low' };

describe('resolveChoice', () => {
  it('matches the server resolver on the configured default', () => {
    expect(resolveChoice(configured, {})).toEqual(selected);
  });

  // Regression: switching connector used to fall back to the built-in default, and Settings
  // then saved that over the model chosen for the backend being left.
  it('reads each backend own saved slot', () => {
    expect(resolveChoice(configured, { backend: 'opencode' })).toEqual({
      backend: 'opencode',
      model: 'opencode/big-pickle',
      effort: 'max',
    });
    expect(resolveChoice({ ...configured, backend: 'opencode' }, { backend: 'claude-code' })).toEqual(
      selected,
    );
  });

  it('falls back to the built-in default for a backend never configured', () => {
    const onlyClaude = {
      backend: 'claude-code',
      backends: { 'claude-code': { model: 'sonnet', effort: 'low' } },
    };
    expect(resolveChoice(onlyClaude, { backend: 'opencode' })).toEqual({
      backend: 'opencode',
      model: 'opencode/deepseek-v4-flash-free',
      effort: 'high',
    });
  });

  it('falls back entirely with no snapshot yet', () => {
    expect(resolveChoice(undefined, {})).toEqual({ backend: 'claude-code', model: 'opus', effort: 'high' });
  });

  it('reads the legacy single-slot shape as the selected backend own', () => {
    const legacy = { backend: 'claude-code', model: 'haiku', effort: 'max' };
    expect(resolveChoice(legacy, {})).toEqual({ backend: 'claude-code', model: 'haiku', effort: 'max' });
    expect(resolveChoice(legacy, { backend: 'opencode' }).model).toBe('opencode/deepseek-v4-flash-free');
  });

  it('keeps the configured model when the override names the configured backend', () => {
    expect(resolveChoice(configured, { backend: 'claude-code' })).toEqual(selected);
  });
});

describe('clampToCaps', () => {
  // OpenCode has no plan/acceptEdits permission split, so a Claude mode must not survive
  // the switch — the dock would render a selected button that does not exist.
  it('falls back to the backend first mode when the carried-over one does not apply', () => {
    expect(clampToCaps({ backend: 'opencode', model: 'x', effort: 'high' }, 'acceptEdits')).toEqual({
      mode: 'build',
      effort: 'high',
    });
  });

  it('keeps a mode and effort that the backend does support', () => {
    expect(clampToCaps({ backend: 'claude-code', model: 'opus', effort: 'xhigh' }, 'plan')).toEqual({
      mode: 'plan',
      effort: 'xhigh',
    });
  });

  // "xhigh" is a Claude effort; OpenCode publishes low|medium|high|max.
  it('falls back to the backend default effort when the scale differs', () => {
    expect(clampToCaps({ backend: 'opencode', model: 'x', effort: 'xhigh' }, 'build')).toEqual({
      mode: 'build',
      effort: 'high',
    });
  });
});

describe('isOverridden', () => {
  it('is true only when the resolved selection actually differs from the default', () => {
    expect(isOverridden(configured, {})).toBe(false);
    expect(isOverridden(configured, { effort: 'xhigh' })).toBe(true);
    expect(isOverridden(configured, { backend: 'opencode' })).toBe(true);
  });

  // Switching connector away and back leaves `{backend}` set while resolving to exactly the
  // configured default. Claiming a session override there made the dock look confused.
  it('is false when an override names the configured backend', () => {
    expect(isOverridden(configured, { backend: 'claude-code' })).toBe(false);
  });

  it('is false when an override restates the configured value', () => {
    expect(isOverridden(configured, { model: 'sonnet', effort: 'low' })).toBe(false);
  });
});

describe('isOverridden compares resolved selections', () => {
  const configured = {
    backend: 'claude-code',
    backends: {
      'claude-code': { model: 'sonnet', effort: 'low' },
      opencode: { model: 'opencode/x', effort: 'max' },
    },
  };

  it('is false when the override names the backend already selected', () => {
    // Switching connector away and back leaves {backend} set while changing nothing; claiming an
    // override in that state reads as the UI losing track of itself.
    expect(isOverridden(configured, { backend: 'claude-code' })).toBe(false);
  });

  it.each([
    [{ backend: 'opencode' }, true],
    [{ model: 'haiku' }, true],
    [{ effort: 'high' }, true],
    [{}, false],
    [{ model: 'sonnet' }, false], // same value as configured
    [{ effort: 'low' }, false],
    [{ backend: 'claude-code', model: 'sonnet', effort: 'low' }, false], // all redundant
  ])('reports %o as overridden=%p', (override, expected) => {
    expect(isOverridden(configured, override)).toBe(expected);
  });

  it('detects each field independently rather than short-circuiting on the first', () => {
    // A comparison that only looked at backend, or only at model, would miss these.
    expect(isOverridden(configured, { backend: 'claude-code', model: 'haiku', effort: 'low' })).toBe(true);
    expect(isOverridden(configured, { backend: 'claude-code', model: 'sonnet', effort: 'high' })).toBe(true);
  });

  it('is false with no configured project and an empty override', () => {
    expect(isOverridden(undefined, {})).toBe(false);
  });
});

// Backend alone must register as an override. With both slots holding identical values, changing
// backend leaves model and effort untouched, so only the backend comparison can notice.
describe('isOverridden notices a backend-only change', () => {
  const twins = {
    backend: 'claude-code',
    backends: {
      'claude-code': { model: 'same', effort: 'same' },
      opencode: { model: 'same', effort: 'same' },
    },
  };

  it('is true when only the backend differs', () => {
    const now = resolveChoice(twins, { backend: 'opencode' });
    const base = resolveChoice(twins, {});
    expect([now.model, now.effort]).toEqual([base.model, base.effort]);
    expect(isOverridden(twins, { backend: 'opencode' })).toBe(true);
  });
});
