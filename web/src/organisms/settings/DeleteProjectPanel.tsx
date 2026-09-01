import { Button } from '../../atoms/Button';
import { Text } from '../../atoms/Text';
import { deleteProject } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import type { Confirmer } from '../../lib/useConfirm';
import { Notice } from '../../molecules/Notice';

interface Props {
  // The open project's own folder path, and the name typed to confirm is its last segment.
  root: string;
  confirm: Confirmer['confirm'];
}

// DELETING THE OPEN PROJECT. Last in Settings and behind a type-the-name dialog, because it is the one
// control in VibeBoard that destroys a person's work and cannot be undone.
//
// The dialog's `requireText` is not the whole confirmation: the route checks the same name again. A
// confirm that lives only in the browser is a confirm the API does not have, and this route is reachable
// by anything holding the admin token.
export function DeleteProjectPanel({ root, confirm }: Props) {
  const { busy, error, run } = useAction<'delete'>();
  const name = root.split('/').filter(Boolean).at(-1) ?? root;

  async function remove(): Promise<void> {
    const ok = await confirm({
      title: `Delete ${name}?`,
      body: 'Every card, board, run, report and document in this folder is removed from disk, along with this project’s agent containers and their session state. There is no undo and nothing is moved to a wastebasket. Your sign-in and your agent credentials are not touched.',
      action: 'Delete it',
      danger: true,
      requireText: name,
    });
    if (!ok) return;
    await run(async () => {
      await deleteProject(root, name);
      // A full reload rather than a state update: the project this whole page is about no longer exists,
      // and every panel behind this modal is showing something read out of it.
      window.location.reload();
    }, 'delete');
  }

  return (
    <>
      <Text caps ink="accent" className="settings-section">
        Delete this project
      </Text>
      <div className="vb-field">
        <Button
          className="vb-self-start"
          size="md"
          variant="danger"
          disabled={busy !== null}
          onClick={() => void remove()}
        >
          {busy === 'delete' ? 'Deleting…' : `Delete ${name}`}
        </Button>
        <Text role="hint">
          Removes the folder and everything in it, this project's agent containers, and the per-project agent
          state VibeBoard keeps outside the folder. Refused while auto-pilot is running or a run is still
          going.
        </Text>
      </div>
      {error && (
        <Notice as="p" tone="bad">
          {error}
        </Notice>
      )}
    </>
  );
}
