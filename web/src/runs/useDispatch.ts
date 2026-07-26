import { useCallback, useEffect, useState } from 'react';
import { type DispatchRequest, dispatchRun, listControlFiles, listModels, type ModelOption } from '../api';

// What the details step needs from the server, and the state of the last dispatch.
//
// The model list and the attachable files are fetched here rather than in the pane so switching
// card, or opening the form twice, costs no request.
export function useDispatch(
  backend: string,
  trigger: unknown,
): {
  models: ModelOption[];
  attachable: string[];
  busy: boolean;
  error: string | null;
  run: (request: DispatchRequest) => Promise<void>;
} {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [attachable, setAttachable] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listModels(backend)
      .then((list) => {
        if (live) setModels(list);
      })
      .catch(() => {
        /* the picker falls back to showing the current model alone */
      });
    return () => {
      live = false;
    };
  }, [backend]);

  // Docs and resource files only: instructions steer every turn already, and a skill attaching
  // another skill is a confusion rather than a feature.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate trigger
  useEffect(() => {
    let live = true;
    listControlFiles()
      .then((groups) => {
        if (!live) return;
        setAttachable(
          groups
            .filter((g) => g.key === 'docs' || g.key === 'resources')
            .flatMap((g) => g.files.map((f) => f.path)),
        );
      })
      .catch(() => {
        /* no attachments offered rather than a broken form */
      });
    return () => {
      live = false;
    };
  }, [trigger]);

  const run = useCallback(async (request: DispatchRequest): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await dispatchRun(request);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      throw e; // the pane stays open on a refusal; the shell keeps the reason
    } finally {
      setBusy(false);
    }
  }, []);

  return { models, attachable, busy, error, run };
}
