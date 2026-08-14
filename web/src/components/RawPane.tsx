import { useEffect, useState } from 'react';
import { getRaw, putRaw } from '../api';
import { errorText } from '../errors';
import type { Card } from '../shared';

interface Props {
  card: Card;
}

// The card's file, frontmatter and all. Reads on mount and whenever the card changes; switching
// card discards an uncommitted draft — the same bargain the modal made.
export function RawPane({ card }: Props) {
  // `loading` is its own flag rather than a null draft: a null draft would need a guard in save()
  // that no caller can reach, since the button is disabled until the read lands.
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [onDisk, setOnDisk] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true);
    getRaw(card.board, card.id)
      .then((text) => {
        if (!live) return;
        setOnDisk(text);
        setDraft(text);
        setLoading(false);
      })
      .catch((e) => {
        if (!live) return;
        setError(errorText(e));
        setLoading(false);
      });
    // The card can change under a slow read (a tab switch); applying the first file to the second
    // card would show one card's contents under another's name.
    return () => {
      live = false;
    };
  }, [card.board, card.id]);

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await putRaw(card.board, card.id, draft);
      setOnDisk(draft);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="raw-pane">
      <textarea
        className="raw-area"
        aria-label="card file"
        value={draft}
        placeholder={loading ? 'Loading…' : ''}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="raw-foot">
        {error !== null && <span className="raw-error">{error}</span>}
        <button
          type="button"
          className="btn-primary"
          disabled={busy || loading || draft === onDisk}
          onClick={save}
        >
          Save file
        </button>
      </div>
    </div>
  );
}
