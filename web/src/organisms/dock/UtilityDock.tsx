import { Button } from '../../atoms/Button';
import { Stack } from '../../atoms/Stack';
import { Tabs } from '../../molecules/Tabs';
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
    // A LABELLED LANDMARK IS A `Stack` NOW. The column, the hairline over it and `flex: 0 0 auto` were
    // three of this class's six declarations and are the atom's; `aria-label` on a `<section>` is what
    // kept them here. `gap={0}` because the strip sits directly on the body — the atom's default is 8px.
    <Stack as="section" label="Utilities" direction="column" gap={0} edge="top" className="vb-fixed dock">
      {/* `Tabs` AND NOT `Menu`: the dock stays and the pane inside it changes, which is the whole line
          between the two. The collapse toggle is a member of the STRIP rather than of any tab, which is
          what `children` is for — it was already a sibling of the cells. */}
      <Tabs
        label="Utilities"
        items={panes.map((p) => ({ value: p.id, label: p.label, badge: p.badge }))}
        value={active.id}
        onChange={onPane}
      >
        <Button
          variant="bare"
          size="sm"
          className="push"
          title={collapsed ? 'Expand the dock' : 'Collapse the dock'}
          aria-expanded={!collapsed}
          onClick={onCollapse}
        >
          <span className="vb-twist">{collapsed ? '▴' : '▾'}</span>
        </Button>
      </Tabs>

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
    </Stack>
  );
}
