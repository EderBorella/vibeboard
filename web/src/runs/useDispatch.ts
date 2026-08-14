import { useCallback, useState } from 'react';
import { type DispatchRequest, dispatchRun, listControlFiles, listModels, type ModelOption } from '../api';
import { errorText } from '../errors';
import { useFetched } from '../useFetched';

const NO_MODELS: ModelOption[] = [];
const NO_FILES: string[] = [];

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A failure leaves the picker falling back to showing the current model alone.
  const { value: models } = useFetched(() => listModels(backend), [backend], NO_MODELS);

  // Docs and resource files only: instructions steer every turn already, and a skill attaching
  // another skill is a confusion rather than a feature. A failure offers no attachments rather than
  // a broken form.
  const { value: attachable } = useFetched(
    () =>
      listControlFiles().then((groups) =>
        groups
          .filter((g) => g.key === 'docs' || g.key === 'resources')
          .flatMap((g) => g.files.map((f) => f.path)),
      ),
    [trigger],
    NO_FILES,
  );

  const run = useCallback(async (request: DispatchRequest): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await dispatchRun(request);
    } catch (e) {
      const message = errorText(e);
      setError(message);
      throw e; // the pane stays open on a refusal; the shell keeps the reason
    } finally {
      setBusy(false);
    }
  }, []);

  return { models, attachable, busy, error, run };
}
