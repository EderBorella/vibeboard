import { describe, it, expect } from 'vitest';
import { resolveChoice, clampToCaps, isOverridden } from '../web/src/copilot/choice.js';

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
