import { useEffect, useState } from 'react';
import { getResources, putResources, type ResourceLink } from '../../lib/api';
import { Button } from '../../atoms/Button';
import { Control } from '../../atoms/Control';
import { Readout } from '../../atoms/Readout';
import { errorText } from '../../lib/errors';
import { Row } from '../shared/Row';
import { useAction } from '../../lib/useAction';

// The links registry (.vibeboard/resources.yaml) — a small editable table of external
// references the user (and copilot) can consult. It owns its own rows and dirty flag because
// nothing outside this pane reads them; only errors are handed back up to the shared banner.
// Rows carry a client-only id so React keys survive a delete: an index key would hand the
// removed row's DOM node (and its focus) to its neighbour. Named `ResourceRow` and not `Row`: the
// `Row` component is imported four lines above and a type sharing its name shadows nothing at runtime
// but reads as though it does.
type ResourceRow = ResourceLink & { rowId: string };
let seq = 0;
const withId = (l: ResourceLink): ResourceRow => ({ ...l, rowId: `r${seq++}` });

export function ResourcesEditor({ onError }: { onError: (e: string | null) => void }) {
  const [links, setLinks] = useState<ResourceRow[]>([]);
  const [dirty, setDirty] = useState(false);
  // This pane has no banner of its own: only errors are handed back up to the shared one.
  const { busy, run } = useAction(onError);

  useEffect(() => {
    let live = true;
    getResources()
      .then((l) => {
        if (live) {
          setLinks(l.map(withId));
          setDirty(false);
        }
      })
      .catch((e: unknown) => onError(errorText(e)));
    return () => {
      live = false;
    };
  }, [onError]);

  const update = (i: number, patch: Partial<ResourceLink>): void => {
    setLinks((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
    setDirty(true);
  };
  const add = (): void => {
    setLinks((prev) => [...prev, withId({ title: '', url: '' })]);
    setDirty(true);
  };
  const removeRow = (i: number): void => {
    setLinks((prev) => prev.filter((_, idx) => idx !== i));
    setDirty(true);
  };

  async function save(): Promise<void> {
    await run(async () => {
      const clean = links.filter((l) => l.title.trim() || l.url.trim());
      await putResources(clean.map(({ title, url }) => ({ title, url })));
      setLinks(clean);
      setDirty(false);
    });
  }

  return (
    <>
      <div className="vb-editor-head">
        <Readout>Links registry{dirty ? ' •' : ''}</Readout>
        <div className="vb-row push">
          <Button size="md" onClick={add}>
            ＋ Add link
          </Button>
          <Button variant="primary" size="md" disabled={busy !== null || !dirty} onClick={save}>
            Save
          </Button>
        </div>
      </div>
      <div className="resources-table">
        {links.length === 0 && (
          <div className="empty">No links yet. Add references the copilot can consult.</div>
        )}
        {/* NOT `Field`s: this is a table row, and each placeholder is the column heading. A label per
            cell would repeat "Title / URL / Note" once per link. The boxes are the primitive's — the
            rule they had was byte-identical to `.vb-ctl` already. */}
        {links.map((l, i) => (
          <Row key={l.rowId}>
            <Control
              className="res-title"
              placeholder="Title"
              value={l.title}
              onChange={(e) => update(i, { title: e.target.value })}
            />
            <Control
              className="res-url"
              placeholder="https://…"
              value={l.url}
              onChange={(e) => update(i, { url: e.target.value })}
            />
            <Control
              className="res-note"
              placeholder="Note (optional)"
              value={l.note ?? ''}
              onChange={(e) => update(i, { note: e.target.value })}
            />
            <Button variant="bare" size="sm" className="res-del" title="Remove" onClick={() => removeRow(i)}>
              ✕
            </Button>
          </Row>
        ))}
      </div>
    </>
  );
}
