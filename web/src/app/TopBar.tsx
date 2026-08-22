import { type AutopilotState, isSuccessReason } from '../api';
import { autopilotAdvice, type TransportState } from '../autopilot/transport';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { StatusChip } from '../ui/StatusChip';
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

// What auto-pilot is doing, in one word. `complete` is the ONLY stop styled as a success: an exhausted
// budget, a reached cap and a stalled board all end tidily and none of them means the work is done —
// "an error or an exhausted budget never counts as success".
// `state` AND NOT `tone`: these four words are rows in ui/state-tones.ts, and the same four the
// transport strip and its dot use. They were typed `string` and read by a stylesheet that gave
// `running` the palette's SECONDARY while the bar below gave the same word the primary.
function chipFor(state: AutopilotState): { label: string; state: TransportState } | null {
  if (state.state === 'idle') return null; // nothing to say, and a chip per tab would be noise
  if (state.state === 'running') return { label: 'auto-pilot running', state: 'running' };
  if (state.state === 'halted') return { label: 'halted', state: 'halted' };
  const reason = state.reason ?? 'stopped';
  return { label: reason, state: isSuccessReason(reason) ? 'complete' : 'stopped' };
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
  autopilot,
  light,
  lightTitle,
  agentRefusal,
  refusalKind,
  recentFailure,
}: Props) {
  const chip = autopilot ? chipFor(autopilot) : null;
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
      {showProject && chip && autopilot && (
        // `state`, AND IT IS A ROW IN THE TABLE NOW. The note here used to argue that "the palette does
        // not fit the five" because `running` was `--accent-2`, the palette's secondary, which is not
        // `--warn` in marshmallow. That defended a token this surface had picked: the same `running`
        // rendered `--text` on a report chip and `--accent` on the auto-pilot bar's rail, three colours
        // for one fact. `--warn` is the attention token, `--accent-2` is a hue, and `running` is
        // `accent` wherever it is said. See ui/state-tones.ts.
        // A `StatusChip`, AND THE CHANGE A PERSON WILL NOTICE IS THAT IT NOW OPENS. It was the only one
        // of the four indicators with no dot and no way to read its explanation: `title={detail}` put
        // the loop's own stop sentence — which names the branch it could not create and quotes git
        // underneath — into a tooltip that truncates it, on the one indicator that is on screen from
        // every tab. `autopilotAdvice` is where that sentence goes now.
        <StatusChip
          state={chip.state}
          dot={8}
          word={chip.label}
          advice={autopilotAdvice(autopilot)}
          title={autopilot.detail ?? chip.label}
          className="ap-chip"
          testId="ap-chip"
        />
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
            takes the primitive's box through `.vb-input`, which is what primitives.css names it for. */}
        <select className="vb-input" value={theme} title="Theme" onChange={(e) => onTheme(e.target.value)}>
          {THEMES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
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
