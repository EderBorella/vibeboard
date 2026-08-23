import { useEffect, useState } from 'react';
import { getRaw, putRaw } from '../../lib/api';
import { Button } from '../../atoms/Button';
import { Control } from '../../atoms/Control';
import { Text } from '../../atoms/Text';
import { errorText } from '../../lib/errors';
import type { Card } from '../../lib/shared';
import { useAction } from '../../lib/useAction';

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
  const { busy, error, run, setError } = useAction();

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
    // `setError` comes from `useAction`; a useState setter's identity is stable, so it is in the list
    // for the exhaustive-dependency check rather than because it can change.
  }, [card.board, card.id, setError]);

  async function save(): Promise<void> {
    await run(async () => {
      await putRaw(card.board, card.id, draft);
      setOnDisk(draft);
    });
  }

  return (
    <div className="raw-pane" data-fill>
      {/* NOT a `Field`: this IS the pane, and the dock tab that opened it is its label. It drew NO box
          at all before Phase 9 — a whole card's file in the browser's own textarea chrome, beside boxes
          that were the primitive's — so `.vb-ctl` is a fix here and not only a merge. */}
      <Control
        as="textarea"
        mono
        className="raw-area"
        aria-label="card file"
        value={draft}
        placeholder={loading ? 'Loading…' : ''}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="raw-foot">
        {error !== null && <Text role="error">{error}</Text>}
        <Button
          variant="primary"
          size="md"
          disabled={busy !== null || loading || draft === onDisk}
          onClick={save}
        >
          Save file
        </Button>
      </div>
    </div>
  );
}
