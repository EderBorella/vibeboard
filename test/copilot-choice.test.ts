import { describe, it, expect } from 'vitest';
import { resolveCopilotSelection } from '../src/core/copilot-choice.js';

// The configured shape holds one saved slot per backend, so switching connector cannot
// destroy the model chosen for the other one.
const configured = {
  backend: 'claude-code',
  backends: {
    'claude-code': { model: 'sonnet', effort: 'low' },
    opencode: { model: 'opencode/big-pickle', effort: 'max' },
  },
};
const selected = { backend: 'claude-code', model: 'sonnet', effort: 'low' };

describe('resolveCopilotSelection', () => {
  it('uses the configured default when the override is empty', () => {
    expect(resolveCopilotSelection(configured, {})).toEqual(selected);
  });

  it('lets each override field win independently', () => {
    expect(resolveCopilotSelection(configured, { model: 'haiku' })).toEqual({
      backend: 'claude-code',
      model: 'haiku',
      effort: 'low',
    });
    expect(resolveCopilotSelection(configured, { effort: 'max' })).toEqual({
      backend: 'claude-code',
      model: 'sonnet',
      effort: 'max',
    });
  });

  // Regression: with a single model slot, switching connector fell back to the built-in
  // default, and saving then overwrote the model chosen for the backend being left. One
  // round-trip through the provider toggle destroyed both choices permanently.
  it('remembers each backend own model and effort', () => {
    expect(resolveCopilotSelection(configured, { backend: 'opencode' })).toEqual({
      backend: 'opencode',
      model: 'opencode/big-pickle',
      effort: 'max',
    });
    // ...and switching back returns the original, not the built-in default.
    expect(
      resolveCopilotSelection({ ...configured, backend: 'opencode' }, { backend: 'claude-code' }),
    ).toEqual(selected);
  });

  it('falls back to the built-in default for a backend never configured', () => {
    const onlyClaude = {
      backend: 'claude-code',
      backends: { 'claude-code': { model: 'sonnet', effort: 'low' } },
    };
    expect(resolveCopilotSelection(onlyClaude, { backend: 'opencode' })).toEqual({
      backend: 'opencode',
      model: 'opencode/deepseek-v4-flash-free',
      effort: 'high',
    });
  });

  // An explicit model wins, while effort still comes from the new backend's saved slot ('max'
  // here) rather than its built-in default — each field resolves independently.
  it('still honours an explicit model alongside an overridden backend', () => {
    expect(resolveCopilotSelection(configured, { backend: 'opencode', model: 'opencode/x' })).toEqual({
      backend: 'opencode',
      model: 'opencode/x',
      effort: 'max',
    });
  });

  it('treats a blank slot as unset', () => {
    const blank = { backend: 'claude-code', backends: { 'claude-code': { model: '', effort: '' } } };
    expect(resolveCopilotSelection(blank, {})).toEqual({
      backend: 'claude-code',
      model: 'opus',
      effort: 'high',
    });
  });

  // Configs written before per-backend slots existed carry a single model/effort pair. They
  // describe whichever backend was selected at the time.
  it('reads the legacy single-slot shape', () => {
    expect(resolveCopilotSelection({ backend: 'claude-code', model: 'haiku', effort: 'max' }, {})).toEqual({
      backend: 'claude-code',
      model: 'haiku',
      effort: 'max',
    });
    // The legacy pair belongs to the configured backend only, never to the other one.
    expect(
      resolveCopilotSelection(
        { backend: 'claude-code', model: 'haiku', effort: 'max' },
        { backend: 'opencode' },
      ),
    ).toEqual({ backend: 'opencode', model: 'opencode/deepseek-v4-flash-free', effort: 'high' });
  });

  it('falls back entirely when no project is open', () => {
    expect(resolveCopilotSelection(undefined, {})).toEqual({
      backend: 'claude-code',
      model: 'opus',
      effort: 'high',
    });
  });

  it('falls back to the default backend model for an unknown backend', () => {
    expect(resolveCopilotSelection({ backend: 'nonsense', backends: {} }, {})).toEqual({
      backend: 'nonsense',
      model: 'opus',
      effort: 'high',
    });
  });
});
