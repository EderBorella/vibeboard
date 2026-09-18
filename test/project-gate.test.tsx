// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  listProjects: vi.fn().mockResolvedValue([]),
  openProject: vi.fn(),
}));
vi.mock('../web/src/lib/api.js', () => api);

const { ProjectGate } = await import('../web/src/pages/gate/ProjectGate.js');

afterEach(() => {
  cleanup();
});

// THE FORM THAT USED TO BE HERE IS THE WIZARD'S IDENTITY STEP NOW, and its assertions went with it to
// test/wizard-view.test.tsx rather than being deleted — the relative-parent refusal in particular, which
// is the one this file was written for. What is left on this screen is the choice between the two doors,
// and the only thing to prove about a door is that it opens.
describe('the two doors', () => {
  it('offers both, and no longer carries the form itself', () => {
    const onNew = vi.fn();
    const onMap = vi.fn();
    render(<ProjectGate onOpened={vi.fn()} onNewProject={onNew} onMapProject={onMap} />);

    fireEvent.click(screen.getByRole('button', { name: 'New project' }));
    fireEvent.click(screen.getByRole('button', { name: 'Map an existing repository' }));

    expect(onNew).toHaveBeenCalledTimes(1);
    expect(onMap).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText(/Location/)).toBeNull();
  });
});
