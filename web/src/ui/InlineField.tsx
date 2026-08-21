import { type KeyboardEvent, type MouseEvent, type ReactNode, useState } from 'react';

interface Props {
  value: string;
  // What the field is, for the hover hint and the accessible name.
  label: string;
  onCommit: (value: string) => void;
  multiline?: boolean;
  rows?: number;
  // Stands in for an empty value, so an unset field is still something to click.
  placeholder?: string;
  className?: string;
  // How a committed value is shown. Defaults to the text; the body passes a markdown renderer.
  display?: (value: string) => ReactNode;
  // Refuses to commit an empty value and reverts instead — a card with no title has no name.
  required?: boolean;
}

// Click to edit, in place. Commits on blur and on Enter (Escape reverts); a multiline field takes
// Enter as a newline and commits on blur alone.
export function InlineField({
  value,
  label,
  onCommit,
  multiline,
  rows = 6,
  placeholder,
  className,
  display,
  required,
}: Props) {
  // null while not editing, so an empty draft is still a draft.
  const [draft, setDraft] = useState<string | null>(null);

  if (draft !== null) {
    // Hoisted to a const so the narrowing survives into the handlers below; a guard inside commit
    // would be one no caller could reach, since commit only exists while editing.
    const current = draft;
    const commit = (): void => {
      const next = current.trim();
      setDraft(null);
      if (required && next === '') return; // reverts: the old value stays
      if (next !== value) onCommit(next);
    };

    const stop = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setDraft(null);
      // Enter commits a single-line field; in a textarea it belongs to the text.
      else if (e.key === 'Enter' && !multiline) commit();
    };
    const common = {
      value: draft,
      'aria-label': label,
      className: 'inline-edit',
      autoFocus: true,
      onBlur: commit,
      onKeyDown: stop,
    };
    return multiline ? (
      <textarea {...common} rows={rows} onChange={(e) => setDraft(e.target.value)} />
    ) : (
      <input {...common} onChange={(e) => setDraft(e.target.value)} />
    );
  }

  const shown = value === '' ? <span className="vb-empty">{placeholder}</span> : (display?.(value) ?? value);
  const cls = `inline-view${className ? ` ${className}` : ''}`;
  const open = (): void => setDraft(value);

  // A multiline value can contain links (rendered markdown), and an anchor inside a button is
  // invalid and unclickable — so this one is a div that ignores clicks landing on a link.
  if (multiline) {
    return (
      <div
        className={cls}
        title={`Edit ${label}`}
        role="button"
        tabIndex={0}
        onClick={(e: MouseEvent) => {
          if (!(e.target as HTMLElement).closest('a')) open();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') open();
        }}
      >
        {shown}
      </div>
    );
  }

  return (
    <button type="button" className={cls} title={`Edit ${label}`} onClick={open}>
      {shown}
    </button>
  );
}
