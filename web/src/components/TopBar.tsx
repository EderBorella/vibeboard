// Add a theme here after adding its [data-theme] block in themes.css.
const THEMES: { value: string; label: string }[] = [
  { value: 'cyberpunk', label: 'Cyberpunk' },
  { value: 'classic-dark', label: 'Classic Dark' },
];

export type MainTab = 'boards' | 'execution' | 'control' | 'explorer';

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
  conn,
}: Props) {
  return (
    <header className="topbar">
      <span className="brand">VibeBoard</span>
      {showProject && <span className="project-name">{projectName}</span>}
      {showProject && (
        <div className="topbar-tabs" role="group" aria-label="View">
          <button className={`tab-btn${tab === 'boards' ? ' active' : ''}`} onClick={() => onTab('boards')}>
            Boards
          </button>
          <button
            className={`tab-btn${tab === 'execution' ? ' active' : ''}`}
            onClick={() => onTab('execution')}
          >
            Execution
            {attentionCount > 0 && <span className="tab-badge">{attentionCount}</span>}
          </button>
          <button className={`tab-btn${tab === 'control' ? ' active' : ''}`} onClick={() => onTab('control')}>
            Project Control
          </button>
          <button
            className={`tab-btn${tab === 'explorer' ? ' active' : ''}`}
            onClick={() => onTab('explorer')}
          >
            Explorer
          </button>
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
