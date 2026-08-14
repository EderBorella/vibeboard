// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  listArchive: vi.fn(async () => [] as unknown[]),
  restoreCard: vi.fn(async () => undefined),
}));
vi.mock('../web/src/api.js', () => api);
vi.mock('../web/src/api', () => api);

const { ArchiveDrawer } = await import('../web/src/components/ArchiveDrawer.js');

import type { ArchivedCard, ProjectConfig } from '../web/src/shared.js';

afterEach(() => {
  cleanup();
  api.listArchive.mockReset();
  api.restoreCard.mockReset();
});

const config: ProjectConfig = {
  name: 'T',
  boards: {
    features: { columns: ['Backlog', 'Done'] },
    product: { columns: ['Backlog', 'Done'] },
    engineering: { columns: ['Todo', 'Done'] },
  },
  miniatureChars: 40,
  idPadding: 3,
  keepChats: 20,
  contextBudget: 200_000,
  maxConcurrentRuns: 3,
  copilot: { backend: 'claude-code', backends: {} },
};

const archived: ArchivedCard = {
  id: 'E-001',
  title: 'Something finished',
  restoreTo: 'todo',
  archived: '2026-08-13T10:00:00.000Z',
  archivedFrom: 'todo',
  order: 10,
  tags: [],
  links: [],
  created: '2026-08-01',
  board: 'engineering',
  columnSlug: 'archive',
  body: '',
  filePath: 'boards/engineering/archive/E-001.md',
};

const show = () => render(<ArchiveDrawer board="engineering" config={config} count={0} />);

// `catch` receives `unknown`, whatever the annotation says. Both handlers here read `.message` off it,
// and a rejection that is not an Error is not exotic: `fetch` rejects with a TypeError on a dropped
// connection, and anything that throws a string or a null lands in the same place. Reading a property
// off it either renders an empty banner (so the drawer says "Loading…" for ever over a failed fetch)
// or throws a second time inside the handler, where nothing catches it.
describe('the archive drawer when the fetch fails with something that is not an Error', () => {
  it.each([['a string', 'the archive is unreachable'] as const, ['a null', null] as const])(
    'still shows the failure for %s rejection',
    async (_label, thrown) => {
      api.listArchive.mockRejectedValue(thrown);
      show();
      await waitFor(() => expect(screen.getByText(String(thrown))).toBeTruthy());
    },
  );

  it('still shows the failure when a restore rejects with a non-Error', async () => {
    api.listArchive.mockResolvedValue([archived]);
    api.restoreCard.mockRejectedValue('that column is gone');
    show();
    await waitFor(() => expect(screen.getByText('Something finished')).toBeTruthy());

    fireEvent.click(screen.getByText(/Restore/));

    await waitFor(() => expect(screen.getByText('that column is gone')).toBeTruthy());
  });
});
