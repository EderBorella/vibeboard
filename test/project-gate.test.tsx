// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  listProjects: vi.fn().mockResolvedValue([]),
  openProject: vi.fn(),
  scaffoldProject: vi.fn().mockResolvedValue({ snapshot: {} }),
}));
vi.mock('../web/src/api.js', () => api);

const { ProjectGate } = await import('../web/src/app/ProjectGate.js');

afterEach(() => {
  cleanup();
  api.scaffoldProject.mockClear();
});

// WHERE A NEW PROJECT GOES, caught here as well as at the endpoint.
//
// This form concatenates a free-text parent folder with the name, so `data/projects` — one missing
// leading slash — asked the server to create `data/projects/calculator`. Node resolved that against the
// SERVER's working directory, and the project was created inside the VibeBoard install: docker refused
// its box because a relative string is a volume NAME to `-v`, auto-pilot's pre-flight commit ran in
// VibeBoard's own repository and stopped a run over a failure in VibeBoard's test suite, and the
// project never got the `.git/hooks` pin its box relies on.
//
// The endpoint refuses it too, and that is the one that counts — this half is so the answer arrives
// before a request rather than as a 400 after it. Both are asserted, because the reason a person can
// see and the reason a machine enforces are different things and either can rot alone.
function fill(parent: string, name: string): void {
  render(<ProjectGate onOpened={() => {}} />);
  fireEvent.change(screen.getByLabelText(/location/i), { target: { value: parent } });
  fireEvent.change(screen.getByLabelText(/name/i), { target: { value: name } });
}

describe('the new-project form', () => {
  it('will not create against a relative parent folder', () => {
    fill('data/projects', 'calculator');

    const create = screen.getByRole('button', { name: /create/i }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.click(create);
    expect(api.scaffoldProject).not.toHaveBeenCalled();
  });

  it('says what is wrong rather than only refusing', () => {
    // A disabled button with no explanation is indistinguishable from a broken one — the person is
    // one character from a working path and cannot see which character.
    fill('data/projects', 'calculator');

    expect(screen.getByText(/absolute path/i)).toBeTruthy();
  });

  it('creates against an absolute one, at the path it previews', () => {
    fill('/data/projects', 'calculator');

    expect(screen.getByText('/data/projects/calculator')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    expect(api.scaffoldProject).toHaveBeenCalledWith('/data/projects/calculator', 'calculator');
  });
});
