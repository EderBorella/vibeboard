import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../atoms/Button';
import { Chip } from '../../atoms/Chip';
import { Control } from '../../atoms/Control';
import { Readout } from '../../atoms/Readout';
import { Stack } from '../../atoms/Stack';
import { Surface } from '../../atoms/Surface';
import { Text } from '../../atoms/Text';
import type { ModelOption } from '../../lib/api';
import { List } from './List';
import { Modal } from './Modal';
import { compareModels, type ModelFilter, matchesFilter } from './model-filter';
import { fmtCtx, fmtPrice, loadFavs, providerOf, saveFavs } from './model-format';
import { Row } from './Row';

interface Props {
  models: ModelOption[];
  value: string;
  defaultModel: string; // this backend's default — pinned to the top of the list
  onChange: (id: string) => void;
  disabled?: boolean;
}

// Model selector: a trigger button that opens a filterable modal. Filters default to
// tool-capable (the copilot needs tools to edit cards). Favorites persist in localStorage.
export function ModelPicker({ models, value, defaultModel, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [toolOnly, setToolOnly] = useState(true);
  const [freeOnly, setFreeOnly] = useState(false);
  const [visionOnly, setVisionOnly] = useState(false);
  const [provider, setProvider] = useState('all');
  const [favs, setFavs] = useState<Set<string>>(loadFavs);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const toggleFav = (id: string): void => {
    setFavs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveFavs(next);
      return next;
    });
  };

  const pick = (id: string): void => {
    onChange(id);
    setOpen(false);
  };

  const providers = useMemo(() => {
    const set = new Set(models.map((m) => providerOf(m.id)));
    return ['all', ...[...set].sort()];
  }, [models]);

  const filtered = useMemo(() => {
    const filter: ModelFilter = { query, provider, toolOnly, freeOnly, visionOnly, value, defaultModel };
    return models
      .filter((m) => matchesFilter(m, filter))
      .sort((a, b) => compareModels(a, b, { defaultModel, favs }));
  }, [models, query, toolOnly, freeOnly, visionOnly, provider, favs, value, defaultModel]);

  const selected = models.find((m) => m.id === value);
  const label = selected?.name ?? value ?? '';

  const chip = (on: boolean, set: (v: boolean) => void, text: string): React.ReactNode => (
    <Chip
      as="button"
      pill
      fill
      tone="neutral"
      className={`mp-chip${on ? ' on' : ''}`}
      onClick={() => set(!on)}
    >
      {text}
    </Chip>
  );

  return (
    <div className="mp">
      <Control as="trigger" disabled={disabled} onClick={() => setOpen(true)} title={value}>
        <Readout className="vb-clip">
          {selected?.free ? '🆓 ' : ''}
          {label}
        </Readout>
        <span className="vb-caret vb-twist">▾</span>
      </Control>

      {open && (
        <Modal
          size="md"
          tone="accent"
          title="Choose a model"
          label="Choose a model"
          onClose={() => setOpen(false)}
          head={
            <Button variant="bare" size="sm" onClick={() => setOpen(false)}>
              ✕
            </Button>
          }
        >
          <Control
            autoFocus
            value={query}
            placeholder="Search by name or id…"
            onChange={(e) => setQuery(e.target.value)}
          />

          <Stack gap={3} wrap pad={[0, 6, 3]}>
            {chip(toolOnly, setToolOnly, '🔧 Tool use')}
            {chip(freeOnly, setFreeOnly, '🆓 Free')}
            {chip(visionOnly, setVisionOnly, '👁 Vision')}
            {/* NOT a `Field`: a filter in a row of filters, named by its own first option. `push` is
                  the one layout utility in the file and it is what `.mp-prov`'s whole remainder was. */}
            <Control
              as="select"
              className="push"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            >
              {providers.map((p) => (
                <option key={p} value={p}>
                  {p === 'all' ? 'All providers' : p}
                </option>
              ))}
            </Control>
          </Stack>

          <Readout>
            {filtered.length} of {models.length} models
          </Readout>

          <List fill scroll className="mp-list">
            {filtered.map((m) => (
              // A `Row` with a star before the pick. `rail="accent"` is what `.mp-def`'s hand-written
              // `border-left` was; `interactive`/`active` are `.mp-item:hover` and `.mp-sel`.
              <Row
                key={m.id}
                interactive
                active={m.id === value}
                rail={m.id === defaultModel ? 'accent' : undefined}
                data-testid="mp-item"
                lead={
                  <Button
                    variant="bare"
                    size="sm"
                    title={favs.has(m.id) ? 'Unfavorite' : 'Favorite'}
                    onClick={() => toggleFav(m.id)}
                  >
                    {/* `.mp-star` IS GONE: an ink on a `bare` button's label is a nested `Text` now. */}
                    <Text size="inherit" ink="accent2">
                      {favs.has(m.id) ? '★' : '☆'}
                    </Text>
                  </Button>
                }
              >
                <Surface
                  as="button"
                  variant="flat"
                  className="vb-list"
                  data-testid="mp-pick"
                  onClick={() => pick(m.id)}
                >
                  <span className="mp-pick-top">
                    <span className="vb-clip">{m.name ?? m.id}</span>
                    {m.id === defaultModel && (
                      <Chip pill tone="accent" className="mp-def-tag">
                        default
                      </Chip>
                    )}
                    <Readout>{fmtPrice(m)}</Readout>
                  </span>
                  <span className="mp-pick-bot">
                    <Readout>{m.id}</Readout>
                    <span className="mp-badges">
                      {m.contextLength ? <Readout>{fmtCtx(m.contextLength)}</Readout> : null}
                      {m.caps?.toolCall && <span title="Tool use">🔧</span>}
                      {m.caps?.reasoning && <span title="Reasoning">🧠</span>}
                      {m.caps?.vision && <span title="Vision">👁</span>}
                    </span>
                  </span>
                </Surface>
              </Row>
            ))}
            {filtered.length === 0 && (
              <Text role="hint" lead className="mp-empty">
                No models match the current filters.
              </Text>
            )}
          </List>
        </Modal>
      )}
    </div>
  );
}
