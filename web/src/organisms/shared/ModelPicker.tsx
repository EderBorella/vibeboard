import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../atoms/Button';
import { Chip } from '../../atoms/Chip';
import { Control } from '../../atoms/Control';
import { Icon } from '../../atoms/Icon';
import { Readout } from '../../atoms/Readout';
import { Stack } from '../../atoms/Stack';
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

  const chip = (on: boolean, set: (v: boolean) => void, text: React.ReactNode): React.ReactNode => (
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
          {/* THE SPACE IS EXPLICIT because the mark it replaced carried its own: the glyph was the string
              `"\u{1F193} "`, trailing space included, and JSX drops whitespace that spans a newline
              between two expressions. `.vb-readout` is a plain span with no flex and no gap, so nothing
              else puts a gap here — unlike `.vb-btn` and `.blockers li`, which are flex rows. */}
          {selected?.free ? <Icon name="free" /> : null}
          {selected?.free ? ' ' : ''}
          {label}
        </Readout>
        <span className="vb-caret vb-twist">
          <Icon name="caret-down" />
        </span>
      </Control>

      {open && (
        <Modal
          size="md"
          tone="accent"
          title="Choose a model"
          label="Choose a model"
          onClose={() => setOpen(false)}
          // Named for the same reason the Settings close is: the `✕` it replaced WAS the name.
          head={
            <Button variant="bare" size="sm" title="Close" onClick={() => setOpen(false)}>
              <Icon name="close" />
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
            {chip(
              toolOnly,
              setToolOnly,
              <>
                <Icon name="tool" /> Tool use
              </>,
            )}
            {chip(
              freeOnly,
              setFreeOnly,
              <>
                <Icon name="free" /> Free
              </>,
            )}
            {chip(
              visionOnly,
              setVisionOnly,
              <>
                <Icon name="eye" /> Vision
              </>,
            )}
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

          <List fill scroll pad={[0, 4, 4]}>
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
                      <Icon name={favs.has(m.id) ? 'star-filled' : 'star'} />
                    </Text>
                  </Button>
                }
              >
                <Row as="button" variant="flat" stack data-testid="mp-pick" onClick={() => pick(m.id)}>
                  {/* `.mp-pick-top` and `.mp-pick-bot` WERE A FLEX ROW EACH, and the only thing in them
                      the atom could not say was `min-width: 0` — which is `shrink` now. The two
                      `> .vb-readout` child rules go with them: the price does not shrink (`.vb-fixed`) and
                      the model id takes the slack and ellipsises (`.vb-clip`), both already named. */}
                  <Stack as="span" align="baseline" gap={4} shrink>
                    <span className="vb-clip">{m.name ?? m.id}</span>
                    {m.id === defaultModel && (
                      <Chip pill tone="accent" className="mp-def-tag">
                        default
                      </Chip>
                    )}
                    <Readout className="vb-fixed">{fmtPrice(m)}</Readout>
                  </Stack>
                  <Stack as="span" gap={4} shrink>
                    <Readout className="vb-clip">{m.id}</Readout>
                    {/* `.mp-badges` was `flex: 0 0 auto`, a row with a gap, and `font-size: var(--t-small)`.
                        The first is `.vb-fixed` and the second is the atom. THE THIRD WAS REDUNDANT, and it
                        took the browser harness to establish that rather than reasoning: wrapping the three
                        glyphs in `<Text>` to carry the step instead grew every pick row by 2.4px on all
                        three themes — the atom's `line-height: 1.45` against the line box the row already
                        set — and dropping the wrapper entirely drifted NOTHING. So the row's inherited step
                        was already `--t-small` and the declaration had been saying it twice. Bare spans,
                        which is what they were, and the class has nothing left. */}
                    <Stack as="span" gap={2} className="vb-fixed">
                      {m.contextLength ? <Readout>{fmtCtx(m.contextLength)}</Readout> : null}
                      {m.caps?.toolCall && (
                        <span title="Tool use">
                          <Icon name="tool" />
                        </span>
                      )}
                      {m.caps?.reasoning && (
                        <span title="Reasoning">
                          <Icon name="reasoning" />
                        </span>
                      )}
                      {m.caps?.vision && (
                        <span title="Vision">
                          <Icon name="eye" />
                        </span>
                      )}
                    </Stack>
                  </Stack>
                </Row>
              </Row>
            ))}
            {filtered.length === 0 && (
              // `.mp-empty` WAS A PADDING ON A LINE OF TEXT, and `Text` has no `pad` and is not getting
              // one: a span is not a box, and giving the type atom a padding would make every face in the
              // tree a potential layout decision. The box goes outside it, which is what composition means.
              <Stack pad={[5, 4]}>
                <Text role="hint" lead>
                  No models match the current filters.
                </Text>
              </Stack>
            )}
          </List>
        </Modal>
      )}
    </div>
  );
}
