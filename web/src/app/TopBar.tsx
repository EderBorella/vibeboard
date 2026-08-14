import { type AutopilotState, isSuccessReason } from '../api';
import { ConnectionLight } from './ConnectionLight';
import type { LightState } from './connection-light';

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

// What auto-pilot is doing, in one word. `complete` is the ONLY stop styled as a success: an exhausted
// budget, a reached cap and a stalled board all end tidily and none of them means the work is done —
// "an error or an exhausted budget never counts as success".
function chipFor(state: AutopilotState): { label: string; tone: string } | null {
  if (state.state === 'idle') return null; // nothing to say, and a chip per tab would be noise
  if (state.state === 'running') return { label: 'auto-pilot running', tone: 'running' };
  if (state.state === 'halted') return { label: 'halted', tone: 'halted' };
  const reason = state.reason ?? 'stopped';
  return { label: reason, tone: isSuccessReason(reason) ? 'complete' : 'stopped' };
}

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
  // Absent until the first answer, and absent for a project with nothing to say.
  autopilot?: AutopilotState | null;
  // Already decided by `lightFor` — this component renders the answer and does not compute it. The
  // precedence between a dead socket and a project that cannot run is a rule, and a rule living in JSX
  // is a rule nothing can test on its own.
  light: LightState;
  lightTitle: string;
  // Passed through to the balloon, which shows the server's refusal in full where the tooltip truncates.
  agentRefusal: string | null | undefined;
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
  autopilot,
  light,
  lightTitle,
  agentRefusal,
}: Props) {
  const chip = autopilot ? chipFor(autopilot) : null;
  return (
    <header className="topbar">
      <span className="brand">VibeBoard</span>
      {showProject && <span className="project-name">{projectName}</span>}
      {/* Beside the project name rather than at the far right, and labelled. A 9px dot at the end of a row
          of buttons is the last thing anyone looks at, and it is the one thing that says whether ANYTHING
          else on the page is still true.
          The state is spelled out because a colour cannot say WHICH problem this is, and the five it can
          report need four different responses: reconnect, sign in, wait, or install a missing dependency.
          `offline` is the last of those — the project is reachable but cannot run anything — and it was
          previously visible only as a refusal at the moment you tried to work, or two clicks deep in a
          settings dialog nobody opens before they need it. */}
      <ConnectionLight light={light} title={lightTitle} agentRefusal={agentRefusal} />
      {showProject && chip && (
        <span className={`ap-chip ap-${chip.tone}`} title={autopilot?.detail ?? chip.label}>
          {chip.label}
        </span>
      )}
      {/* The SENTENCE is not here, and the reasoning that put it here is worth keeping because it was true when
          it was written: `whyStuck` names WHICH cards are stuck and why, and all of it once lived in a `title`
          attribute — unreachable on a touch device, invisible to anyone who does not know to hover. What made
          that false is `ap-bar-detail`, which renders the same string below the auto-pilot bar's row, wrapping,
          for every state that has one. So a second copy bought nothing and cost the layout: an unbounded flex
          sibling, so one long sentence shoved the tabs and the buttons right. The chip's `title` keeps it as a
          supplement — a supplement is fine, a duplicate that moves the tabs is not. */}
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
                <span className="tab-badge">{attentionCount}</span>
              )}
            </button>
          ))}
        </div>
      )}
      <div className="topbar-right">
        <select
          className="theme-select"
          value={theme}
          title="Theme"
          onChange={(e) => onTheme(e.target.value)}
        >
          {THEMES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        {showProject && (
          <button className="switch-btn" title="Settings" onClick={onSettings}>
            ⚙
          </button>
        )}
        {showProject && (
          <button className="switch-btn" onClick={onSwitchProject}>
            Switch project
          </button>
        )}
        {showProject && (
          <button className={`switch-btn${copilotOpen ? ' active' : ''}`} onClick={onToggleCopilot}>
            {copilotOpen ? 'Hide copilot' : 'Copilot'}
          </button>
        )}
      </div>
    </header>
  );
}
