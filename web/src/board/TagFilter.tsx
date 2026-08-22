import { Button } from '../atoms/Button';
import { Chip } from '../atoms/Chip';
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
        <Chip
          as="button"
          pill
          fill
          key={tag}
          className={`tag-chip vb-readout${active.includes(tag) ? ' active' : ''}`}
          ariaPressed={active.includes(tag)}
          title={`Cards tagged ${tag}: ${count}`}
          onClick={() => onToggle(tag)}
        >
          {tag}
          <span>{count}</span>
        </Chip>
      ))}
      {active.length > 0 && (
        <Button variant="bare" size="sm" className="tag-filter-clear" onClick={onClear}>
          Clear filter
        </Button>
      )}
    </div>
  );
}
