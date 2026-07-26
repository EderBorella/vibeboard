import type { TagCount } from '../viewmodel';

interface Props {
  tags: TagCount[];
  active: string[];
  onToggle: (tag: string) => void;
  onClear: () => void;
}

// The filter bar above the boards. Selecting several tags narrows to cards carrying all of them
// (see filterByTags), so the chips read as successive refinements rather than an OR set.
export function TagFilter({ tags, active, onToggle, onClear }: Props) {
  // Nothing tagged anywhere: an empty bar would just be a row of dead chrome.
  if (tags.length === 0) return null;

  return (
    <div className="tag-filter" role="group" aria-label="Filter by tag">
      {tags.map(({ tag, count }) => (
        <button
          key={tag}
          className={`tag-chip${active.includes(tag) ? ' active' : ''}`}
          aria-pressed={active.includes(tag)}
          title={`Cards tagged ${tag}: ${count}`}
          onClick={() => onToggle(tag)}
        >
          {tag}
          <span className="tag-chip-count">{count}</span>
        </button>
      ))}
      {active.length > 0 && (
        <button className="tag-filter-clear" onClick={onClear}>
          Clear filter
        </button>
      )}
    </div>
  );
}
