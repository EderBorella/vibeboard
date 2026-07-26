import { type ReactNode, useEffect, useState } from 'react';
import { createCard, getRaw, patchCard, putRaw, setLinks as setLinksApi } from '../api';
import type { BoardName, Card, ProjectConfig } from '../shared';
import { CardForm } from './CardForm';
import { CardView } from './CardView';

export type EditorState =
  | { mode: 'create'; board: BoardName; columnSlug: string }
  | { mode: 'edit'; card: Card };

interface Props {
  editor: EditorState;
  allCards: Card[];
  config: ProjectConfig;
  onClose: () => void;
  onSaved: () => void;
}

// 'view' is read-only and exists in edit mode only — there is nothing to read before a card is
// created. saveCard therefore only ever sees 'form' or 'raw': the View tab renders no Save button.
type Tab = 'view' | 'form' | 'raw';

function csv(values: string[]): string {
  return values.join(', ');
}
function parseCsv(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface CardFields {
  title: string;
  description: string;
  tags: string;
  group: string;
  body: string;
}

export interface SaveInput {
  editor: EditorState;
  tab: Tab;
  fields: CardFields;
  links: string[];
  raw: string;
}

// Which write a save performs depends on the tab and the mode: the Raw tab writes the file
// verbatim, create posts a new card then reconciles links by its assigned id, edit patches.
export async function saveCard(input: SaveInput): Promise<void> {
  const { editor, tab, fields, links, raw } = input;
  if (tab === 'raw' && editor.mode === 'edit') {
    await putRaw(editor.card.board, editor.card.id, raw);
    return;
  }
  if (editor.mode === 'create') {
    const created = await createCard({
      board: editor.board,
      columnSlug: editor.columnSlug,
      title: fields.title,
      description: fields.description || undefined,
      tags: parseCsv(fields.tags),
      group: fields.group || undefined,
      body: fields.body || undefined,
    });
    await setLinksApi(created.board, created.id, links);
    return;
  }
  await patchCard(editor.card.board, editor.card.id, {
    title: fields.title,
    description: fields.description,
    tags: parseCsv(fields.tags),
    group: fields.group,
    body: fields.body,
  });
  await setLinksApi(editor.card.board, editor.card.id, links);
}

// Initial form values, derived once from the card being edited (all blank when creating).
export function initialFields(existing: Card | null): CardFields {
  return {
    title: existing?.title ?? '',
    description: existing?.description ?? '',
    tags: csv(existing?.tags ?? []),
    group: existing?.group ?? '',
    body: existing?.body ?? '',
  };
}

// The tab strip. Its own function because each `active` ternary and each edit-mode-only guard
// counts against the shell's complexity budget, and there are five of them in nine lines.
function ModalTabs({ tab, onTab, hasCard }: { tab: Tab; onTab: (tab: Tab) => void; hasCard: boolean }) {
  return (
    <div className="modal-tabs">
      {hasCard && (
        <button className={tab === 'view' ? 'active' : ''} onClick={() => onTab('view')}>
          View
        </button>
      )}
      <button className={tab === 'form' ? 'active' : ''} onClick={() => onTab('form')}>
        Form
      </button>
      {hasCard && (
        <button className={tab === 'raw' ? 'active' : ''} onClick={() => onTab('raw')}>
          Raw
        </button>
      )}
    </div>
  );
}

// The footer: read-only tab offers Close + Edit, the writing tabs Cancel + Save.
function ModalFoot({
  tab,
  busy,
  saveDisabled,
  onClose,
  onEdit,
  onSave,
}: {
  tab: Tab;
  busy: boolean;
  saveDisabled: boolean;
  onClose: () => void;
  onEdit: () => void;
  onSave: () => void;
}) {
  return (
    <div className="modal-foot">
      <button className="btn-secondary" onClick={onClose} disabled={busy}>
        {tab === 'view' ? 'Close' : 'Cancel'}
      </button>
      {tab === 'view' ? (
        // The obvious way out of a read-only pane, since View is where opening a card lands.
        <button className="btn-primary" onClick={onEdit}>
          Edit
        </button>
      ) : (
        <button className="btn-primary" onClick={onSave} disabled={saveDisabled}>
          Save
        </button>
      )}
    </div>
  );
}

export function CardEditor({ editor, allCards, config, onClose, onSaved }: Props) {
  const existing = editor.mode === 'edit' ? editor.card : null;
  const board = editor.mode === 'edit' ? editor.card.board : editor.board;

  // Any card can link any other card; only exclude the card being edited itself.
  const linkable = allCards.filter((c) => c.id !== existing?.id);

  // Opening a card reads it; creating one has nothing to read.
  const [tab, setTab] = useState<Tab>(existing ? 'view' : 'form');
  const [fields, setFields] = useState<CardFields>(() => initialFields(existing));
  const [links, setLinks] = useState<string[]>(existing?.links ?? []);

  const onField = (patch: Partial<CardFields>): void => setFields((f) => ({ ...f, ...patch }));

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
      await saveCard({ editor, tab, fields, links, raw });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // One pane per tab, chosen before the JSX: a three-way ternary inside it would nest, and
  // nesting is what the complexity rule punishes.
  let pane: ReactNode;
  if (tab === 'view' && existing) pane = <CardView card={existing} config={config} allCards={allCards} />;
  else if (tab === 'form')
    pane = (
      <CardForm
        fields={fields}
        onField={onField}
        linkable={linkable}
        links={links}
        onToggleLink={toggleLink}
      />
    );
  else
    pane = (
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
    );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">
            {editor.mode === 'create' ? `New ${board} card` : `${editor.card.id} · ${board}`}
          </span>
          <ModalTabs tab={tab} onTab={setTab} hasCard={existing !== null} />
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          {pane}
          {error && <div className="modal-error">{error}</div>}
        </div>

        <ModalFoot
          tab={tab}
          busy={busy}
          saveDisabled={busy || (tab === 'form' && !fields.title.trim())}
          onClose={onClose}
          onEdit={() => setTab('form')}
          onSave={save}
        />
      </div>
    </div>
  );
}
