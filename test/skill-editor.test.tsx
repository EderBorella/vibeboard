// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Skill } from '../web/src/api.js';
import { SkillEditor } from '../web/src/components/SkillEditor.js';
import type { ProjectConfig } from '../web/src/shared.js';

afterEach(cleanup);

const config: ProjectConfig = {
  name: 'T',
  boards: {
    features: { columns: ['Backlog', 'Done'] },
    product: { columns: ['Backlog', 'In Progress', 'Done'] },
    engineering: { columns: ['Todo', 'Review', 'Done'] },
  },
  miniatureChars: 40,
  idPadding: 3,
  keepChats: 20,
  contextBudget: 200_000,
  maxConcurrentRuns: 3,
  copilot: { backend: 'claude-code', backends: {} },
};

const skill = (over: Partial<Skill> = {}): Skill => ({
  slug: 'execute',
  path: '.claude/skills/execute/SKILL.md',
  name: 'Execute',
  description: 'Implement the card',
  boards: [],
  columns: [],
  prompt: 'Implement the card below.',
  ...over,
});

// Typed so mock.calls[0][0] is the fields object rather than an empty tuple.
type Fields = Parameters<Parameters<typeof SkillEditor>[0]['onSave']>[0];
const saver = () => vi.fn(async (_fields: Fields) => {});
const props = { config, busy: false, onSave: saver() };
const box = (label: string): HTMLInputElement =>
  screen.getByText(label).parentElement?.querySelector('input') as HTMLInputElement;

describe('SkillEditor', () => {
  it('shows the skill as fields', () => {
    render(<SkillEditor {...props} skill={skill({ boards: ['engineering'], columns: ['todo'] })} />);
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Execute');
    expect((screen.getByLabelText('Description') as HTMLInputElement).value).toBe('Implement the card');
    expect((screen.getByLabelText('Prompt') as HTMLTextAreaElement).value).toBe('Implement the card below.');
    expect(box('Engineering').checked).toBe(true);
    expect(box('Todo').checked).toBe(true);
  });

  it('saves nothing until something changes', () => {
    render(<SkillEditor {...props} skill={skill()} />);
    expect((screen.getByText('Save skill') as HTMLButtonElement).disabled).toBe(true);
  });

  it('saves the edited fields', async () => {
    const onSave = saver();
    render(<SkillEditor {...props} onSave={onSave} skill={skill()} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Do it' } });
    fireEvent.click(screen.getByText('Save skill'));
    expect(onSave.mock.calls[0][0]).toEqual({
      name: 'Do it',
      description: 'Implement the card',
      boards: [],
      columns: [],
      prompt: 'Implement the card below.',
    });
  });

  it('offers every column when no board is ticked', () => {
    // Nothing ticked means every board, so every board's columns are pickable.
    render(<SkillEditor {...props} skill={skill()} />);
    expect(screen.getByText('Todo')).toBeTruthy();
    expect(screen.getByText('In Progress')).toBeTruthy();
    expect(screen.getByText('Review')).toBeTruthy();
  });

  it('narrows the columns to the boards that are ticked', () => {
    render(<SkillEditor {...props} skill={skill()} />);
    fireEvent.click(box('Product'));
    expect(screen.getByText('In Progress')).toBeTruthy();
    // Review is engineering-only, so it is no longer pickable — which is exactly what the validator
    // would have rejected.
    expect(screen.queryByText('Review')).toBeNull();
  });

  it('drops a ticked column that the new board scope no longer allows', () => {
    // Otherwise the save would fail validation on a column the user can no longer even see.
    const onSave = saver();
    render(<SkillEditor {...props} onSave={onSave} skill={skill({ columns: ['review'] })} />);
    expect(box('Review').checked).toBe(true);
    fireEvent.click(box('Product'));
    fireEvent.click(screen.getByText('Save skill'));
    expect(onSave.mock.calls[0][0]).toMatchObject({ boards: ['product'], columns: [] });
  });

  it('lists a shared column once, however many boards have it', () => {
    render(<SkillEditor {...props} skill={skill()} />);
    expect(screen.getAllByText('Done')).toHaveLength(1);
  });

  it('refuses to save an empty name, description or prompt', () => {
    render(<SkillEditor {...props} skill={skill()} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  ' } });
    expect((screen.getByText('Save skill') as HTMLButtonElement).disabled).toBe(true);
  });

  it('refuses to save while a write is in flight', () => {
    render(<SkillEditor {...props} busy skill={skill()} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Do it' } });
    expect((screen.getByText('Save skill') as HTMLButtonElement).disabled).toBe(true);
  });
});
