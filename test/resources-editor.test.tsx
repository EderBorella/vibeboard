// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getResources: vi.fn(async () => [] as unknown[]),
  putResources: vi.fn(async () => undefined),
}));
vi.mock('../web/src/api.js', () => api);
vi.mock('../web/src/api', () => api);

const { ResourcesEditor } = await import('../web/src/control/ResourcesEditor.js');

afterEach(() => {
  cleanup();
  api.getResources.mockReset();
  api.putResources.mockReset();
});

// The load handler read `.message` off whatever the promise rejected with. `catch` receives `unknown`,
// so a rejection that is not an Error handed the banner `undefined` — a pane that stays blank over a
// failed fetch — or threw inside the handler, where nothing catches it.
describe('the links registry when the load fails with something that is not an Error', () => {
  it.each(['the registry is unreadable', null])('reports %s rather than nothing', async (thrown) => {
    api.getResources.mockRejectedValue(thrown);
    const onError = vi.fn();

    render(<ResourcesEditor onError={onError} />);

    await waitFor(() => expect(onError).toHaveBeenCalledWith(String(thrown)));
  });
});
