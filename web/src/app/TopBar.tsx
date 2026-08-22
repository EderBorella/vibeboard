import { Button } from '../atoms/Button';
import { Chip } from '../atoms/Chip';
import { Control } from '../atoms/Control';
import { ConnectionLight } from './ConnectionLight';
import type { LightState, RecentFailure, RefusalKind } from './connection-light';

// Add a theme here after adding its [data-theme] block in themes.css.
const THEMES: { value: string; label: string }[] = [
  { value: 'cyberpunk', label: 'Cyberpunk' },
  { value: 'classic-dark', label: 'Classic Dark' },
  { value: 'marshmallow', label: 'Marshmallow' },
];

// The tabs, in the order they are read. A table rather than five near-identical buttons: adding the fifth
// took this component past the complexity ceiling, which is the rule pointing at the duplication rather
// than at the size — and the type is now derived from the list, so the two cannot disagree.
//
// `diary` IS the permanent button the spec asks for. A hand-driven session's log should read like an
// auto-pilot one, so adding an entry has to be reachable from wherever the person is working.
const TABS = [
  { value: 'boards', label: 'Boards' },
  { value: 'execution', label: 'Execution' },
  { value: 'diary', label: 'Project Log' },
  { value: 'control', label: 'Project Control' },
  { value: 'explorer', label: 'Explorer' },
] as const;

export type MainTab = (typeof TABS)[number]['value'];

interface Props {
  // False while loading, on the project gate, or with no project open — everything except the
  // brand, the theme picker and the connection dot is hidden behind it.
  showProject: boolean;
  projectName?: string;
  tab: MainTab;
  onTab: (tab: MainTab) => void;
  // Runs waiting for a decision. Shown on the Execution tab as a badge, because a run that needs
  // you is easy to miss on a board you are not looking at.
  attentionCount: number;
  theme: string;
  onTheme: (theme: string) => void;
  copilotOpen: boolean;
  onToggleCopilot: () => void;
  onSettings: () => void;
  onSwitchProject: () => void;
  // Already decided by `lightFor` — this component renders the answer and does not compute it. The
  // precedence between a dead socket and a project that cannot run is a rule, and a rule living in JSX
  // is a rule nothing can test on its own.
  light: LightState;
  lightTitle: string;
  // Passed through to the balloon, which shows the server's refusal in full where the tooltip truncates.
  agentRefusal: string | null | undefined;
  // And which cause it is about, so the balloon's heading names the right thing to go and fix. There
  // is more than one way to be unable to run agents, and "Docker is not ready" is wrong for all but one.
  refusalKind?: RefusalKind | null;
  // And what already broke, so the balloon can quote the harness on runs that died before reaching a
  // model. Reported, never enforced — nothing on this path refuses a dispatch.
  recentFailure?: RecentFailure | null;
}

export function TopBar({
  showProject,
  projectName,
  tab,
  attentionCount,
  onTab,
  theme,
  onTheme,
  copilotOpen,
  onToggleCopilot,
  onSettings,
  onSwitchProject,
  light,
  lightTitle,
  agentRefusal,
  refusalKind,
  recentFailure,
}: Props) {
  return (
    <header className="topbar">
      <span className="brand">VibeBoard</span>
      {showProject && <span className="project-name">{projectName}</span>}
      {/* Beside the project name rather than at the far right, and labelled. A 9px dot at the end of a row
          of buttons is the last thing anyone looks at, and it is the one thing that says whether ANYTHING
          else on the page is still true.
          The state is spelled out because a colour cannot say WHICH problem this is, and the six it can
          report need five different responses: reconnect, sign in, wait, install a missing dependency, or
          go and read what the last runs died of. `offline` is the fourth of those — the project is
          reachable but cannot run anything — and it was previously visible only as a refusal at the moment
          you tried to work, or two clicks deep in a settings dialog nobody opens before they need it.
          `failing` is the fifth and the newest, and it is the only one that is not about the present: the
          morning it was added, auto-pilot had stopped itself on two runs that never reached a model and
          this light said `online` throughout, because nothing was refusing anything. */}
      <ConnectionLight
        light={light}
        title={lightTitle}
        agentRefusal={agentRefusal}
        refusalKind={refusalKind}
        recentFailure={recentFailure}
      />
      {/* AND NO AUTO-PILOT CHIP. There were two indicators for one loop — one here beside the project name
          and one on the bar that runs it — and they were not a summary and a detail of each other: this said
          `auto-pilot running` while the bar said `4 dispatches · E-004 · implement`, and on a stop this said
          the reason while the bar said `Stopped.` The owner ruled that one of the two goes, and it is this
          one: the surface with the Start button on it is where a person watches the loop.
          WHAT IT COSTS is that the header is on every tab and the bar is only on Boards, so a loop that
          stops while you are reading the Project Log no longer says so where you are looking. That is a real
          loss and it was taken deliberately against the worse problem, which is two indicators for one fact
          with no rule about which of them is authoritative.
          `.ap-chip` moved with it — the class is on the bar's chip now — and `chipFor` moved to
          autopilot/transport.ts as `wordFor`, where the loop's other display decisions already live. */}
      {/* AND THE STOP SENTENCE WAS NEVER HERE EITHER, which is the older half of the same argument and is
          worth keeping now that the chip has gone with it: `whyStuck` names which cards are stuck and why, it
          once lived in a `title` nobody hovers, and rendering it in the header made it an unbounded flex
          sibling that shoved the tabs and the buttons right. It lives in `ap-bar-detail`, wrapping, below the
          bar's row. */}
      {showProject && (
        <div className="topbar-tabs" role="group" aria-label="View">
          {TABS.map(({ value, label }) => (
            <button
              type="button"
              key={value}
              className={`tab-btn${tab === value ? ' active' : ''}`}
              onClick={() => onTab(value)}
            >
              {label}
              {value === 'execution' && attentionCount > 0 && (
                <Chip pill className="tab-badge vb-readout" testId="tab-badge">
                  {attentionCount}
                </Chip>
              )}
            </button>
          ))}
        </div>
      )}
      <div className="topbar-right">
        {/* NOT A `Field`: the top bar carries no labels, and the value this shows is its own name. It
            takes the primitive's box through `.vb-ctl`, which is what primitives.css names it for. */}
        <Control as="select" value={theme} title="Theme" onChange={(e) => onTheme(e.target.value)}>
          {THEMES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Control>
        {showProject && (
          <Button size="sm" className="switch-btn" title="Settings" onClick={onSettings}>
            ⚙
          </Button>
        )}
        {showProject && (
          <Button size="sm" className="switch-btn" onClick={onSwitchProject}>
            Switch project
          </Button>
        )}
        {showProject && (
          <Button size="sm" className={`switch-btn${copilotOpen ? ' active' : ''}`} onClick={onToggleCopilot}>
            {copilotOpen ? 'Hide copilot' : 'Copilot'}
          </Button>
        )}
      </div>
    </header>
  );
}
