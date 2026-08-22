import { useCallback, useEffect, useState } from 'react';
import {
  type AutopilotState,
  getSandbox,
  listModels,
  type ModelOption,
  patchConfig,
  type SandboxState,
} from '../api';
import { Button } from '../atoms/Button';
import { Control } from '../atoms/Control';
import { Surface } from '../atoms/Surface';
import { Text } from '../atoms/Text';
import { AutopilotPanel } from '../autopilot/AutopilotPanel';
import type { Confirmer } from '../confirm/useConfirm';
import { BackendPicker } from '../copilot/BackendPicker';
import { clampToCaps, resolveChoice } from '../copilot/choice';
// The same list the picker renders from, and the reason this file no longer declares its own: the two
// had drifted to different labels for one backend, so the setting read as "Claude Code" here and
// "Claude" in the dock that obeys it.
import { BACKENDS } from '../copilot/format';
import { ModelPicker } from '../models/ModelPicker';
import {
  type AutopilotConfig,
  BOARD_LABELS,
  BOARDS,
  type BoardName,
  backendCaps,
  backendDefaults,
  type CopilotBackendConfig,
  DEFAULT_CONTEXT_BUDGET,
  type ProjectConfig,
} from '../shared';
import { SignInPanel } from '../signin/SignInPanel';
import { Field } from '../ui/Field';
import { useAction } from '../useAction';
import { useFetched } from '../useFetched';
import { parseCsv } from '../viewmodel';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { SandboxPanel } from './SandboxPanel';

interface Props {
  config: ProjectConfig;
  onClose: () => void;
  onSaved: () => void;
  // Passed down rather than fetched again. `useAutopilot(0)` inside the panel hard-coded App's project
  // counter to 0, and `socketFor` is a single-entry last-write-wins cache — so opening Settings after a
  // project switch replaced the tab's socket with a second one, which is the invariant ws.ts exists to
  // hold. It also meant the buttons read the PREVIOUS project's state across a switch.
  autopilot: AutopilotState | null;
  onAutopilotChanged: () => void;
  // Passed down from the shell, which owns the one confirmer and renders its dialog. Signing a browser
  // out is irreversible for the session it kills, and one of the two does it to this browser.
  confirm: Confirmer['confirm'];
}

// A number box left blank, or holding something that is not a number, means "leave this as it was".
const orKeep = (text: string | number, current: number): number => Number(text) || current;

const NO_MODELS: ModelOption[] = [];

export function SettingsModal({ config, onClose, onSaved, autopilot, onAutopilotChanged, confirm }: Props) {
  const [backend, setBackend] = useState(resolveChoice(config.copilot, {}).backend);
  // The auto-pilot caps, edited in the panel below and saved with everything else — one Save button,
  // and one place for the server's refusal to appear (which may be about the routing table rather than
  // the number that was touched).
  // Named apart from `caps` below, which is the BACKEND's capabilities — two different meanings of a
  // short word in one component is how the wrong one gets read.
  const [apCaps, setApCaps] = useState<Partial<AutopilotConfig>>({});
  // One editable slot per backend, so editing OpenCode's model cannot disturb Claude's. The
  // two are separate settings that happen to share one pair of controls; keeping a single slot
  // meant switching connector overwrote the model saved for the one you left.
  const [slots, setSlots] = useState<Record<string, CopilotBackendConfig>>(() => {
    const o: Record<string, CopilotBackendConfig> = {};
    for (const b of BACKENDS) o[b.value] = resolveChoice(config.copilot, { backend: b.value });
    return o;
  });
  // Never blank: an unset model used to mean "the CLI picks", which hid what was running.
  const { model, effort } = slots[backend] ?? resolveChoice(config.copilot, { backend });
  const setModel = (m: string): void => setSlots((s) => ({ ...s, [backend]: { ...s[backend], model: m } }));
  const setEffort = (e: string): void => setSlots((s) => ({ ...s, [backend]: { ...s[backend], effort: e } }));
  const [columns, setColumns] = useState<Record<BoardName, string>>(() => {
    const o = {} as Record<BoardName, string>;
    for (const b of BOARDS) o[b] = (config.boards[b]?.columns ?? []).join(', ');
    return o;
  });
  const [enforceOneParent, setEnforceOneParent] = useState(config.enforceOneParent === true);
  const [miniatureChars, setMiniatureChars] = useState(config.miniatureChars);
  const [idPadding, setIdPadding] = useState(config.idPadding);
  const [keepChats, setKeepChats] = useState(config.keepChats ?? 20);
  const [contextBudget, setContextBudget] = useState(config.contextBudget ?? DEFAULT_CONTEXT_BUDGET);
  const [sandbox, setSandbox] = useState<SandboxState | null>(null);
  const { busy, error, run } = useAction();
  const caps = backendCaps(backend);

  // Models depend on the chosen backend (claude aliases vs `opencode models`). Emptied on a failure
  // rather than kept: the picker is a menu of what can be chosen now, and one backend's aliases are
  // not offerable under the other.
  const { value: models } = useFetched(() => listModels(backend), [backend], NO_MODELS, {
    onFailure: 'clear',
  });

  // Refetched on demand as well as on open: restarting the server or taking one over changes what
  // this panel is reporting, and a stale "attached" line would keep offering an action that already
  // happened.
  const loadSandbox = useCallback(() => {
    getSandbox()
      .then(setSandbox)
      .catch(() => setSandbox(null));
  }, []);
  useEffect(loadSandbox, [loadSandbox]);

  async function save(): Promise<void> {
    await run(async () => {
      const boards = {} as ProjectConfig['boards'];
      for (const b of BOARDS) boards[b] = { columns: parseCsv(columns[b]) };
      await patchConfig({
        // Every backend's slot, not just the active one — the modal can edit both.
        copilot: { backend, backends: slots },
        boards,
        enforceOneParent,
        miniatureChars: orKeep(miniatureChars, config.miniatureChars),
        idPadding: orKeep(idPadding, config.idPadding),
        keepChats: orKeep(keepChats, config.keepChats ?? 20),
        contextBudget: orKeep(contextBudget, DEFAULT_CONTEXT_BUDGET),
        // Only when a cap was actually EDITED, and then the whole block.
        //
        // Both halves matter. The whole block, because the server validates the routing table on any
        // patch touching `autopilot` and a partial one would ask it to check a block with no terminal
        // in it. Only when edited, because the check runs on any patch that touches the key at all —
        // so sending it unconditionally undid the fix of the commit immediately before this slice
        // (a project whose lifecycle is invalid could once again save no setting at all, and the
        // refusal spoke about columns while the user was changing their model).
        ...(config.autopilot && Object.keys(apCaps).length > 0
          ? { autopilot: { ...config.autopilot, ...apCaps } }
          : {}),
      });
      onSaved();
    });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <Surface className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">Settings</span>
          <Button variant="bare" size="sm" onClick={onClose}>
            ✕
          </Button>
        </div>

        <div className="modal-body">
          <div className="settings-section">Copilot</div>
          <Field as="div" label="Backend">
            {/* Only the selected backend changes: each backend's model/effort live in their own slot,
                so switching here reveals that backend's saved choice instead of overwriting it with a
                built-in default. Nothing is written until Save — unlike the auto-pilot bar's copy of
                this control, which writes on the click because a bar has no Save button to wait for. */}
            <BackendPicker value={backend} label="Backend" size="md" onChange={setBackend} />
          </Field>
          <Field as="div" label="Default model">
            <ModelPicker
              models={models}
              value={model}
              defaultModel={backendDefaults(backend).model}
              onChange={setModel}
            />
          </Field>
          <Field label={`Default ${backend === 'opencode' ? 'variant' : 'effort'}`}>
            <Control
              as="select"
              value={clampToCaps({ backend, model, effort }, 'plan').effort}
              onChange={(e) => setEffort(e.target.value)}
            >
              {caps.efforts.map((e) => (
                <option key={e.value} value={e.value}>
                  {e.label}
                </option>
              ))}
            </Control>
          </Field>
          <Field label="Keep last N chats">
            <Control
              type="number"
              min={1}
              value={keepChats}
              onChange={(e) => setKeepChats(Number(e.target.value))}
            />
          </Field>
          <Field label="Context window (tokens)">
            <Control
              type="number"
              min={1000}
              step={1000}
              value={contextBudget}
              onChange={(e) => setContextBudget(Number(e.target.value))}
            />
          </Field>
          <Text role="hint">
            What the context bar treats as full. Set it to the window of the model you actually use —{' '}
            {DEFAULT_CONTEXT_BUDGET.toLocaleString()} over-reports occupancy several times over on a
            million-token model.
          </Text>

          {sandbox && <SandboxPanel state={sandbox} backend={backend} onChanged={loadSandbox} />}

          <div className="settings-section">Boards</div>
          <Text role="hint">
            Columns are comma-separated (left→right). Renaming one moves its folder, so its cards come with
            it. A column that still holds cards can't be removed, and renaming and reordering in the same save
            is refused — do those one at a time.
          </Text>
          {config.autopilot && (
            // Only when there is a block to break. Adding a column is free now that nothing routes — the
            // lifecycle is code (ruling 52) — but REMOVING the terminal or blocked column is still refused,
            // and being refused at Save with no warning beforehand is a dead end.
            <div className="vb-notice vb-notice-warn" data-testid="columns-warning">
              <strong>Auto-pilot reads two of these columns by name.</strong> Renaming one is carried across
              for you.{' '}
              <strong>
                Removing the column a board finishes in, or engineering's blocked column, will be refused
              </strong>{' '}
              until you change what names it: edit <code>terminal</code> and <code>blockedColumn</code> in{' '}
              <code>.vibeboard/config.yaml</code> in the same change.
            </div>
          )}
          {BOARDS.map((b) => (
            <Field key={b} label={`${BOARD_LABELS[b]} columns`}>
              <Control
                value={columns[b]}
                onChange={(e) => setColumns((c) => ({ ...c, [b]: e.target.value }))}
              />
            </Field>
          ))}

          <Field layout="check" label="Enforce 1-to-many relations on boards">
            <input
              type="checkbox"
              checked={enforceOneParent}
              onChange={(e) => setEnforceOneParent(e.target.checked)}
            />
          </Field>
          <Text role="hint">
            A card gets one parent on the board above it — features → product → engineering. Off by default,
            because linking a card to two places is legitimate when you mean it. Agent runs are held to this
            rule either way: it is the hierarchy auto-pilot rolls up, and an agent cannot mean “see also”.
          </Text>

          <AutopilotPanel
            config={config}
            onCaps={setApCaps}
            autopilot={autopilot}
            onAutopilotChanged={onAutopilotChanged}
          />

          <div className="settings-section">Cards</div>
          <div className="settings-row">
            <Field label="Miniature length">
              <Control
                type="number"
                value={miniatureChars}
                onChange={(e) => setMiniatureChars(Number(e.target.value))}
              />
            </Field>
            <Field label="ID padding">
              <Control
                type="number"
                value={idPadding}
                onChange={(e) => setIdPadding(Number(e.target.value))}
              />
            </Field>
          </div>

          {/* Both of these save themselves and are NOT part of what the Save button writes: they are
              app-level, stored outside every project, so a project-config patch is the wrong carrier. */}
          <DiagnosticsPanel />

          {/* Last, because nobody comes to Settings for it: sign-in is meant to be something the user
              never touches. It is here so the credential is FINDABLE — "unless he wants to check in
              the settings" — and because signing everything out is the only way to replace one. */}
          <SignInPanel confirm={confirm} />

          {error && <div className="vb-notice vb-notice-bad">{error}</div>}
        </div>

        <div className="modal-foot">
          <Button size="md" onClick={onClose} disabled={busy !== null}>
            Cancel
          </Button>
          <Button variant="primary" size="md" onClick={save} disabled={busy !== null}>
            Save
          </Button>
        </div>
      </Surface>
    </div>
  );
}
