import { type AutopilotState, isSuccessReason } from '../api';

// Add a theme here after adding its [data-theme] block in themes.css.
const THEMES: { value: string; label: string }[] = [
  { value: 'cyberpunk', label: 'Cyberpunk' },
  { value: 'classic-dark', label: 'Classic Dark' },
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
  conn: string;
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
  conn,
}: Props) {
  const chip = autopilot ? chipFor(autopilot) : null;
  return (
    <header className="topbar">
      <span className="brand">VibeBoard</span>
      {showProject && <span className="project-name">{projectName}</span>}
      {showProject && chip && (
        <span className={`ap-chip ap-${chip.tone}`} title={autopilot?.detail ?? chip.label}>
          {chip.label}
        </span>
      )}
      {/* The sentence, not only the word. `whyStuck` works hard to name WHICH cards are stuck and why, and all
          of it used to live in a `title` attribute — unreachable on a touch device, and invisible to anyone who
          does not know to hover. Shown for a stop the loop decided (`stalled`, `capped`, `exhausted`, `no-op`,
          `complete`) and not for one a person asked for, which needs no explaining. A halt has the overlay. */}
      {autopilot?.state === 'stopped' && autopilot.reason !== 'stopped' && autopilot.detail && (
        <span className="ap-detail" data-testid="ap-stop-detail" title={autopilot.detail}>
          {autopilot.detail}
        </span>
      )}
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
        <span className={`conn conn-${conn}`} title={`WebSocket ${conn}`} />
      </div>
    </header>
  );
}
