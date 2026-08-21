import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { activePane, type DockPane } from './panes';

interface Props {
  panes: DockPane[];
  activeId: string | null;
  onPane: (id: string) => void;
  collapsed: boolean;
  onCollapse: () => void;
}

// The dock below the work area: a strip of pane tabs, a collapse toggle, and the active pane's
// body. It carries no knowledge of any particular pane — see dock/panes.ts.
export function UtilityDock({ panes, activeId, onPane, collapsed, onCollapse }: Props) {
  const active = activePane(panes, activeId);
  // No panes at all: no empty bar taking a row of height off the boards.
  if (!active) return null;

  return (
    <section className="dock" aria-label="Utilities">
      <div className="dock-strip" role="tablist">
        {panes.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={p.id === active.id}
            className={`dock-tab${p.id === active.id ? ' active' : ''}`}
            onClick={() => onPane(p.id)}
          >
            {p.label}
            {p.badge !== undefined && (
              <Chip pill fill className="vb-readout" testId="dock-badge">
                {p.badge}
              </Chip>
            )}
          </button>
        ))}
        <Button
          variant="bare"
          size="sm"
          className="push"
          title={collapsed ? 'Expand the dock' : 'Collapse the dock'}
          aria-expanded={!collapsed}
          onClick={onCollapse}
        >
          {collapsed ? '▴' : '▾'}
        </Button>
      </div>

      {/* Hidden rather than unmounted while collapsed, so a keepMounted pane survives folding the
          dock away as well as switching pane. `.dock-body[hidden]` is spelled out in the CSS: the
          UA rule for [hidden] loses to any display declaration. */}
      <div className="dock-body" data-testid="dock-body" hidden={collapsed}>
        {panes
          .filter((p) => p.id === active.id || p.keepMounted)
          .map((p) => (
            <div key={p.id} className="dock-pane" hidden={p.id !== active.id}>
              {p.render()}
            </div>
          ))}
      </div>
    </section>
  );
}
