import { activePane, type DockPane, visiblePanes } from '../dock/panes';

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
  const visible = visiblePanes(panes);
  const active = activePane(panes, activeId);
  // Nothing to show: no empty bar taking a row of height off the boards.
  if (!active) return null;

  return (
    <section className="dock" aria-label="Utilities">
      <div className="dock-strip" role="tablist">
        {visible.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={p.id === active.id}
            className={`dock-tab${p.id === active.id ? ' active' : ''}`}
            onClick={() => onPane(p.id)}
          >
            {p.label}
            {p.badge !== undefined && <span className="dock-badge">{p.badge}</span>}
          </button>
        ))}
        <button
          type="button"
          className="dock-collapse"
          title={collapsed ? 'Expand the dock' : 'Collapse the dock'}
          aria-expanded={!collapsed}
          onClick={onCollapse}
        >
          {collapsed ? '▴' : '▾'}
        </button>
      </div>

      {/* Hidden rather than unmounted while collapsed, so a keepMounted pane survives folding the
          dock away as well as switching pane. `.dock-body[hidden]` is spelled out in the CSS: the
          UA rule for [hidden] loses to any display declaration. */}
      <div className="dock-body" hidden={collapsed}>
        {visible
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
