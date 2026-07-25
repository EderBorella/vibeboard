import { useEffect, useState } from 'react';
import { BOARDS, BOARD_LABELS, type BoardName, type Card } from '../shared';
import { createCard, patchCard, getRaw, putRaw, setLinks as setLinksApi } from '../api';

export type EditorState =
  | { mode: 'create'; board: BoardName; columnSlug: string }
  | { mode: 'edit'; card: Card };

interface Props {
  editor: EditorState;
  allCards: Card[];
  onClose: () => void;
  onSaved: () => void;
}

type Tab = 'form' | 'raw';

function csv(values: string[]): string {
  return values.join(', ');
}
function parseCsv(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function CardEditor({ editor, allCards, onClose, onSaved }: Props) {
  const existing = editor.mode === 'edit' ? editor.card : null;
  const board = editor.mode === 'edit' ? editor.card.board : editor.board;

  // Any card can link any other card; only exclude the card being edited itself.
  const linkable = allCards.filter((c) => c.id !== existing?.id);

  const [tab, setTab] = useState<Tab>('form');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [tags, setTags] = useState(csv(existing?.tags ?? []));
  const [group, setGroup] = useState(existing?.group ?? '');
  const [links, setLinks] = useState<string[]>(existing?.links ?? []);
  const [body, setBody] = useState(existing?.body ?? '');

  function toggleLink(id: string): void {
    setLinks((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }
  const [raw, setRaw] = useState('');
  const [rawLoaded, setRawLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Lazy-load the on-disk file when the Raw tab is first opened (edit mode only).
  useEffect(() => {
    if (tab === 'raw' && existing && !rawLoaded) {
      getRaw(existing.board, existing.id)
        .then((text) => {
          setRaw(text);
          setRawLoaded(true);
        })
        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    }
  }, [tab, existing, rawLoaded]);

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      if (tab === 'raw' && existing) {
        await putRaw(existing.board, existing.id, raw);
      } else if (editor.mode === 'create') {
        // Create the card first, then reconcile links symmetrically by its new id.
        const created = await createCard({
          board: editor.board,
          columnSlug: editor.columnSlug,
          title,
          description: description || undefined,
          tags: parseCsv(tags),
          group: group || undefined,
          body: body || undefined,
        });
        await setLinksApi(created.board, created.id, links);
      } else {
        await patchCard(editor.card.board, editor.card.id, {
          title,
          description,
          tags: parseCsv(tags),
          group,
          body,
        });
        await setLinksApi(editor.card.board, editor.card.id, links);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">
            {editor.mode === 'create' ? `New ${board} card` : `${editor.card.id} · ${board}`}
          </span>
          <div className="modal-tabs">
            <button className={tab === 'form' ? 'active' : ''} onClick={() => setTab('form')}>
              Form
            </button>
            {existing && (
              <button className={tab === 'raw' ? 'active' : ''} onClick={() => setTab('raw')}>
                Raw
              </button>
            )}
          </div>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          {tab === 'form' ? (
            <>
              <label className="field">
                <span>Title</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
              </label>
              <label className="field">
                <span>Description</span>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Miniature summary"
                />
              </label>
              <label className="field">
                <span>Tags (comma-separated)</span>
                <input value={tags} onChange={(e) => setTags(e.target.value)} />
              </label>
              <label className="field">
                <span>Group</span>
                <input value={group} onChange={(e) => setGroup(e.target.value)} />
              </label>
              <div className="field">
                <span>Linked cards</span>
                {linkable.length === 0 ? (
                  <div className="links-hint">No other cards yet to link.</div>
                ) : (
                  <div className="links-list">
                    {BOARDS.map((b) => {
                      const group = linkable.filter((c) => c.board === b);
                      if (group.length === 0) return null;
                      return (
                        <div key={b}>
                          <div className="links-group">{BOARD_LABELS[b]}</div>
                          {group.map((c) => (
                            <label key={c.id} className="link-option">
                              <input
                                type="checkbox"
                                checked={links.includes(c.id)}
                                onChange={() => toggleLink(c.id)}
                              />
                              <span className="link-id">{c.id}</span>
                              <span className="link-title">{c.title}</span>
                            </label>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <label className="field">
                <span>Body (markdown)</span>
                <textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
              </label>
            </>
          ) : (
            <label className="field field-grow">
              <span>File contents (frontmatter + body)</span>
              <textarea
                className="raw-area"
                rows={18}
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                placeholder={rawLoaded ? '' : 'Loading…'}
              />
            </label>
          )}
          {error && <div className="modal-error">{error}</div>}
        </div>

        <div className="modal-foot">
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save} disabled={busy || (tab === 'form' && !title.trim())}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
