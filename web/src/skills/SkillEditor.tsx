import { useState } from 'react';
import type { Skill } from '../api';
import { BOARD_LABELS, BOARDS, type BoardName, type ProjectConfig } from '../shared';
import { Button } from '../ui/Button';
import { slugify } from '../viewmodel';

interface Props {
  skill: Skill;
  config: ProjectConfig;
  busy: boolean;
  onSave: (fields: {
    name: string;
    description: string;
    boards: BoardName[];
    columns: string[];
    prompt: string;
  }) => Promise<void>;
}

// A skill as fields rather than YAML.
//
// Boards and columns are tick-lists built from the live config, so an unpickable value cannot be
// typed — which is most of what made a hand-written skill invalid. The file is still the truth:
// Raw is one click away, and what this saves is serialised on the server.
export function SkillEditor({ skill, config, busy, onSave }: Props) {
  const [name, setName] = useState(skill.name);
  const [description, setDescription] = useState(skill.description);
  const [boards, setBoards] = useState<BoardName[]>(skill.boards);
  const [columns, setColumns] = useState<string[]>(skill.columns);
  const [prompt, setPrompt] = useState(skill.prompt);
  const [dirty, setDirty] = useState(false);

  // Which columns can be ticked: those on the boards this skill claims, or on every board when it
  // claims none — the same rule the validator applies, so the editor cannot offer an invalid pick.
  const scope = boards.length > 0 ? boards : [...BOARDS];
  const columnChoices = [
    ...new Map(
      scope.flatMap((board) => config.boards[board].columns.map((label) => [slugify(label), label] as const)),
    ),
  ];

  const touch =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setDirty(true);
    };

  const toggleBoard = (board: BoardName): void => {
    const next = boards.includes(board) ? boards.filter((b) => b !== board) : [...boards, board];
    touch(setBoards)(next);
    // A column that is no longer in scope would fail validation the moment it was saved.
    const allowed = new Set(
      (next.length > 0 ? next : [...BOARDS]).flatMap((b) =>
        config.boards[b].columns.map((label) => slugify(label)),
      ),
    );
    setColumns((prev) => prev.filter((c) => allowed.has(c)));
  };

  return (
    <div className="skill-editor">
      <div className="skill-row">
        <label className="skill-label" htmlFor="skill-name">
          Name
        </label>
        <input
          id="skill-name"
          className="skill-input"
          value={name}
          onChange={(e) => touch(setName)(e.target.value)}
        />
      </div>
      <div className="skill-row">
        <label className="skill-label" htmlFor="skill-description">
          Description
        </label>
        <input
          id="skill-description"
          className="skill-input"
          placeholder="What this does, shown on the rail button"
          value={description}
          onChange={(e) => touch(setDescription)(e.target.value)}
        />
      </div>

      <fieldset className="skill-scope">
        <legend>Boards</legend>
        <p className="skill-hint">Nothing ticked means every board.</p>
        {BOARDS.map((board) => (
          <label key={board} className="link-option">
            <input type="checkbox" checked={boards.includes(board)} onChange={() => toggleBoard(board)} />
            <span>{BOARD_LABELS[board]}</span>
          </label>
        ))}
      </fieldset>

      <fieldset className="skill-scope">
        <legend>Columns</legend>
        <p className="skill-hint">Nothing ticked means every column.</p>
        {columnChoices.map(([slug, label]) => (
          <label key={slug} className="link-option">
            <input
              type="checkbox"
              checked={columns.includes(slug)}
              onChange={() =>
                touch(setColumns)(
                  columns.includes(slug) ? columns.filter((c) => c !== slug) : [...columns, slug],
                )
              }
            />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>

      <label className="skill-label" htmlFor="skill-prompt">
        Prompt
      </label>
      <textarea
        id="skill-prompt"
        className="skill-prompt"
        rows={12}
        value={prompt}
        onChange={(e) => touch(setPrompt)(e.target.value)}
      />

      <div className="skill-foot">
        <Button
          variant="primary"
          size="md"
          disabled={busy || !dirty || name.trim() === '' || description.trim() === '' || prompt.trim() === ''}
          onClick={() => {
            void onSave({ name, description, boards, columns, prompt }).then(() => setDirty(false));
          }}
        >
          Save skill
        </Button>
      </div>
    </div>
  );
}
