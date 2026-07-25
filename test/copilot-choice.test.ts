import { describe, it, expect } from 'vitest';
import { resolveCopilotSelection } from '../src/core/copilot-choice.js';

const claude = { backend: 'claude-code', model: 'sonnet', effort: 'low' };

describe('resolveCopilotSelection', () => {
  it('uses the configured default when the override is empty', () => {
    expect(resolveCopilotSelection(claude, {})).toEqual(claude);
  });

  it('lets each override field win independently', () => {
    expect(resolveCopilotSelection(claude, { model: 'haiku' }))
      .toEqual({ backend: 'claude-code', model: 'haiku', effort: 'low' });
    expect(resolveCopilotSelection(claude, { effort: 'max' }))
      .toEqual({ backend: 'claude-code', model: 'sonnet', effort: 'max' });
  });

  // A model id means nothing to the other backend — "sonnet" is not an OpenCode model.
  it('drops the configured model and effort when the backend is overridden', () => {
    expect(resolveCopilotSelection(claude, { backend: 'opencode' }))
      .toEqual({ backend: 'opencode', model: 'opencode/deepseek-v4-flash-free', effort: 'high' });
  });

  it('still honours an explicit model alongside an overridden backend', () => {
    expect(resolveCopilotSelection(claude, { backend: 'opencode', model: 'opencode/x' }))
      .toEqual({ backend: 'opencode', model: 'opencode/x', effort: 'high' });
  });

  it('treats a blank left over in an old config as unset', () => {
    expect(resolveCopilotSelection({ backend: 'claude-code', model: '', effort: '' }, {}))
      .toEqual({ backend: 'claude-code', model: 'opus', effort: 'high' });
  });

  it('falls back entirely when no project is open', () => {
    expect(resolveCopilotSelection(undefined, {}))
      .toEqual({ backend: 'claude-code', model: 'opus', effort: 'high' });
  });

  it('falls back to the default backend for an unknown one', () => {
    expect(resolveCopilotSelection({ backend: 'nonsense' }, {}))
      .toEqual({ backend: 'nonsense', model: 'opus', effort: 'high' });
  });
});
