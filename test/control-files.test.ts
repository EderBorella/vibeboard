import { mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createControlFile,
  deleteControlFile,
  listControlFiles,
  readControlFile,
  readResources,
  renameControlFile,
  resolveControlPath,
  writeControlFile,
  writeResources,
} from '../src/server/control-files.js';
import { tempDir } from './helpers.js';

// The allow-list in categoryOf runs on the path AS GIVEN, before anything is resolved. So the
// dangerous shape is a traversal that normalises back inside the root: it satisfies the allow-list
// under one category and lands on a file governed by another. `docs/../CLAUDE.md` classifies as
// `docs` — deletable — while CLAUDE.md is an instruction file that must never be deletable.
// Removing the `..` guard leaves the whole suite green, so this is its only witness.
describe('control-files traversal that normalises back inside the root', () => {
  it.each([
    'docs/../CLAUDE.md',
    'docs/../INSTRUCTIONS.md',
    'docs/../VIBEBOARD.md',
    'docs/../.claude/skills/x/SKILL.md',
    'docs/../docs/notes.md',
    'docs/./../docs/notes.md',
    'resources/../CLAUDE.md',
  ])('refuses %s', async (bad) => {
    expect(await resolveControlPath(await tempDir(), bad)).toBeNull();
  });

  it('does not let a traversal borrow a deletable category to reach a protected file', async () => {
    const root = await tempDir();
    await writeFile(join(root, 'CLAUDE.md'), '# managed\n', 'utf8');

    // Were this allowed it would resolve to CLAUDE.md while describing itself as a doc, and
    // deletable: true would let the delete route remove a file the UI protects.
    expect(await resolveControlPath(root, 'docs/../CLAUDE.md')).toBeNull();
    expect(await deleteControlFile(root, 'docs/../CLAUDE.md')).toBe('invalid');
    expect(await readFile(join(root, 'CLAUDE.md'), 'utf8')).toBe('# managed\n');
  });

  it('refuses a non-string path instead of throwing', async () => {
    const root = await tempDir();
    for (const bad of [null, undefined, 123, {}, [], true]) {
      expect(await resolveControlPath(root, bad), String(bad)).toBeNull();
    }
  });

  it('fails closed when the project root itself cannot be resolved', async () => {
    expect(await resolveControlPath(join(await tempDir(), 'gone'), 'docs/x.md')).toBeNull();
  });

  it('allows the resources registry but nothing else under the config dir', async () => {
    const root = await tempDir();
    expect(await resolveControlPath(root, '.vibeboard/resources.yaml')).not.toBeNull();
    for (const bad of ['.vibeboard/config.yaml', '.vibeboard/chat/a.json', '.vibeboard/notes.md']) {
      expect(await resolveControlPath(root, bad), bad).toBeNull();
    }
  });
});

describe('control-files path sandbox', () => {
  it('rejects traversal, absolute paths, and non-control paths', async () => {
    const root = await tempDir();
    for (const bad of [
      '../etc/passwd',
      '/etc/passwd',
      '.vibeboard/config.yaml',
      '.vibeboard/chat/x.json',
      'features/todo/F-001.md', // a card
      'secret.txt', // root, not markdown
      'docs/nested/pic.png', // docs but not markdown
      '',
    ]) {
      expect(await resolveControlPath(root, bad), bad).toBeNull();
    }
  });

  it('accepts the allow-listed control paths', async () => {
    const root = await tempDir();
    for (const ok of [
      'INSTRUCTIONS.md',
      'CLAUDE.md',
      'VIBEBOARD.md',
      'README.md',
      'docs/design.md',
      '.claude/skills/foo/SKILL.md',
      'resources/api-notes.md',
      '.vibeboard/resources.yaml',
    ]) {
      const r = await resolveControlPath(root, ok);
      expect(r, ok).not.toBeNull();
      expect(r!.file.path).toBe(ok);
    }
  });

  it('flags managed + non-deletable for the three managed files only', async () => {
    const root = await tempDir();
    const claude = await resolveControlPath(root, 'CLAUDE.md');
    expect(claude!.file).toMatchObject({ managed: true, deletable: false });
    const ins = await resolveControlPath(root, 'INSTRUCTIONS.md');
    expect(ins!.file).toMatchObject({ managed: false, deletable: false }); // instruction files never deletable
    const doc = await resolveControlPath(root, 'docs/x.md');
    expect(doc!.file).toMatchObject({ managed: false, deletable: true });
  });

  it('rejects a symlink that escapes the project root', async () => {
    const root = await tempDir();
    const outside = await tempDir();
    await writeFile(join(outside, 'target.md'), 'secret', 'utf8');
    await mkdir(join(root, 'resources'), { recursive: true });
    await symlink(join(outside, 'target.md'), join(root, 'resources', 'evil.md'));
    expect(await resolveControlPath(root, 'resources/evil.md')).toBeNull();
  });
});

describe('control-files CRUD', () => {
  it('creates, lists, reads, and deletes a doc', async () => {
    const root = await tempDir();
    expect(await writeControlFile(root, 'docs/design.md', '# Design\n')).toBe(true);

    const groups = await listControlFiles(root);
    const docs = groups.find((g) => g.key === 'docs')!;
    expect(docs.files.map((f) => f.path)).toContain('docs/design.md');

    const read = await readControlFile(root, 'docs/design.md');
    expect(read!.content).toBe('# Design\n');

    expect(await deleteControlFile(root, 'docs/design.md')).toBe('ok');
    const after = await listControlFiles(root);
    expect(after.find((g) => g.key === 'docs')!.files.map((f) => f.path)).not.toContain('docs/design.md');
  });

  it('creates skills nested and refuses to delete an instruction file', async () => {
    const root = await tempDir();
    await writeControlFile(root, '.claude/skills/greet/SKILL.md', 'skill');
    const skills = (await listControlFiles(root)).find((g) => g.key === 'skills')!;
    expect(skills.files.map((f) => f.path)).toContain('.claude/skills/greet/SKILL.md');

    await writeControlFile(root, 'CLAUDE.md', 'managed');
    expect(await deleteControlFile(root, 'CLAUDE.md')).toBe('not-allowed');
    expect(await readFile(join(root, 'CLAUDE.md'), 'utf8')).toBe('managed'); // untouched
  });

  it('takes the skill folder with SKILL.md when nothing else is in it', async () => {
    // The bug this fixes: the folder survived, readSkills saw a directory with no SKILL.md, and
    // every card's rail warned about it — with no file for Project Control to select, so nothing
    // could clear the warning.
    const root = await tempDir();
    await writeControlFile(root, '.claude/skills/greet/SKILL.md', 'skill');

    expect(await deleteControlFile(root, '.claude/skills/greet/SKILL.md')).toBe('ok');
    await expect(readdir(join(root, '.claude/skills/greet'))).rejects.toThrow();
    // The skills root itself is untouched — only the one folder went.
    expect(await readdir(join(root, '.claude/skills'))).toEqual([]);
  });

  it('leaves a skill folder that still holds something the user put there', async () => {
    // Deleting SKILL.md is not permission to delete a script beside it. The folder then simply is
    // not a skill any more, and the catalogue ignores it.
    const root = await tempDir();
    await writeControlFile(root, '.claude/skills/greet/SKILL.md', 'skill');
    await writeFile(join(root, '.claude/skills/greet/run.sh'), '#!/bin/sh\n', 'utf8');

    expect(await deleteControlFile(root, '.claude/skills/greet/SKILL.md')).toBe('ok');
    expect(await readdir(join(root, '.claude/skills/greet'))).toEqual(['run.sh']);
  });

  it('removes no directory when the deleted file is nested inside a skill', async () => {
    const root = await tempDir();
    await writeControlFile(root, '.claude/skills/greet/SKILL.md', 'skill');
    await mkdir(join(root, '.claude/skills/greet/scripts'), { recursive: true });
    await writeFile(join(root, '.claude/skills/greet/scripts/a.sh'), 'x', 'utf8');

    expect(await deleteControlFile(root, '.claude/skills/greet/scripts/a.sh')).toBe('ok');
    // The scripts folder is now empty, and stays: only a skill's own SKILL.md takes a folder.
    expect(await readdir(join(root, '.claude/skills/greet/scripts'))).toEqual([]);
    expect(await readdir(join(root, '.claude/skills/greet'))).toContain('SKILL.md');
  });

  it('takes no folder when the last file in a skill folder is not SKILL.md', async () => {
    // Only SKILL.md carries the skill's identity. Deleting a stray note that happens to be the last
    // thing in the folder must not take the folder with it — the user made that folder on purpose,
    // and it is theirs until they say otherwise.
    const root = await tempDir();
    await writeControlFile(root, '.claude/skills/greet/notes.md', 'just a note');

    expect(await deleteControlFile(root, '.claude/skills/greet/notes.md')).toBe('ok');
    expect(await readdir(join(root, '.claude/skills/greet'))).toEqual([]);
  });

  it('takes no folder when a doc is deleted', async () => {
    const root = await tempDir();
    await writeControlFile(root, 'docs/notes.md', '# n');
    expect(await deleteControlFile(root, 'docs/notes.md')).toBe('ok');
    expect(await readdir(join(root, 'docs'))).toEqual([]);
  });

  it('write/read/delete reject non-control paths', async () => {
    const root = await tempDir();
    expect(await writeControlFile(root, '../escape.md', 'x')).toBe(false);
    expect(await readControlFile(root, '.vibeboard/config.yaml')).toBeNull();
    expect(await deleteControlFile(root, '../escape.md')).toBe('invalid');
  });
});

describe('create with default names', () => {
  it('names the first one "New doc" and numbers the rest to avoid collisions', async () => {
    const root = await tempDir();
    const a = await createControlFile(root, 'docs');
    const b = await createControlFile(root, 'docs');
    const c = await createControlFile(root, 'docs');
    expect([a!.path, b!.path, c!.path]).toEqual([
      'docs/new-doc.md',
      'docs/new-doc-2.md',
      'docs/new-doc-3.md',
    ]);
    // and they really exist on disk, independently
    for (const f of [a, b, c]) expect((await readControlFile(root, f!.path))!.content).toContain('#');
  });

  it('creates a skill as a folder holding SKILL.md, with discoverable frontmatter', async () => {
    const root = await tempDir();
    const s = await createControlFile(root, 'skills');
    expect(s!.path).toBe('.claude/skills/new-skill/SKILL.md');
    expect(s!.name).toBe('new-skill'); // the folder, not "SKILL.md"
    const { content } = (await readControlFile(root, s!.path))!;
    expect(content).toMatch(/^---\nname: new-skill\ndescription:/);
  });

  it('numbers skills too, since the folder is what collides', async () => {
    const root = await tempDir();
    await createControlFile(root, 'skills');
    const second = await createControlFile(root, 'skills');
    expect(second!.path).toBe('.claude/skills/new-skill-2/SKILL.md');
  });

  it('refuses categories that cannot be created into', async () => {
    const root = await tempDir();
    expect(await createControlFile(root, 'instructions')).toBeNull();
    expect(await createControlFile(root, 'nonsense')).toBeNull();
  });
});

describe('rename', () => {
  it('renames a doc by display name, slugging the filename', async () => {
    const root = await tempDir();
    const doc = await createControlFile(root, 'docs');
    const renamed = await renameControlFile(root, doc!.path, 'Design Notes');
    expect((renamed as { path: string }).path).toBe('docs/design-notes.md');
    expect(await readControlFile(root, doc!.path)).toMatchObject({ content: '' }); // old path gone
    const files = (await listControlFiles(root)).find((g) => g.key === 'docs')!.files;
    expect(files.map((f) => f.path)).toEqual(['docs/design-notes.md']);
  });

  it('renames a skill by moving its folder and syncing the frontmatter name', async () => {
    const root = await tempDir();
    const skill = await createControlFile(root, 'skills');
    const renamed = await renameControlFile(root, skill!.path, 'Greet the user');
    expect((renamed as { path: string }).path).toBe('.claude/skills/greet-the-user/SKILL.md');
    const { content } = (await readControlFile(root, '.claude/skills/greet-the-user/SKILL.md'))!;
    expect(content).toContain('name: greet-the-user'); // frontmatter followed the folder
    expect(content).not.toContain('name: new-skill');
  });

  it('leaves a hand-picked frontmatter name alone', async () => {
    const root = await tempDir();
    const skill = await createControlFile(root, 'skills');
    await writeControlFile(root, skill!.path, '---\nname: my-own-choice\n---\nbody\n');
    await renameControlFile(root, skill!.path, 'Renamed');
    const { content } = (await readControlFile(root, '.claude/skills/renamed/SKILL.md'))!;
    expect(content).toContain('name: my-own-choice');
  });

  it('tolerates a typed .md extension instead of slugging it into the name', async () => {
    const root = await tempDir();
    const doc = await createControlFile(root, 'docs');
    const renamed = await renameControlFile(root, doc!.path, 'Design Notes.md');
    expect((renamed as { path: string }).path).toBe('docs/design-notes.md'); // not design-notes-md.md
  });

  it('reports a collision instead of clobbering', async () => {
    const root = await tempDir();
    const a = await createControlFile(root, 'docs');
    await renameControlFile(root, a!.path, 'Taken');
    const b = await createControlFile(root, 'docs');
    expect(await renameControlFile(root, b!.path, 'Taken')).toBe('taken');
    // both still present
    const files = (await listControlFiles(root)).find((g) => g.key === 'docs')!.files;
    expect(files.map((f) => f.path).sort()).toEqual(['docs/new-doc.md', 'docs/taken.md']);
  });

  it('rejects instruction files, empty names, and paths outside the sandbox', async () => {
    const root = await tempDir();
    await writeControlFile(root, 'INSTRUCTIONS.md', 'x');
    expect(await renameControlFile(root, 'INSTRUCTIONS.md', 'Nope')).toBeNull();
    const doc = await createControlFile(root, 'docs');
    expect(await renameControlFile(root, doc!.path, '   ')).toBeNull();
    expect(await renameControlFile(root, '../escape.md', 'Nope')).toBeNull();
  });
});

describe('resources registry', () => {
  it('round-trips links and drops empty/garbage entries', async () => {
    const root = await tempDir();
    await mkdir(join(root, '.vibeboard'), { recursive: true });
    await writeResources(root, [
      { title: 'Docs', url: 'https://example.com', note: 'ref' },
      { title: '', url: '' }, // dropped
      'nonsense', // dropped
      { title: 'NoUrl' }, // kept (title only)
    ]);
    const links = await readResources(root);
    expect(links).toEqual([
      { title: 'Docs', url: 'https://example.com', note: 'ref' },
      { title: 'NoUrl', url: '' },
    ]);
  });

  it('returns [] when the file is missing', async () => {
    const root = await tempDir();
    expect(await readResources(root)).toEqual([]);
  });
});

describe('control-files listing', () => {
  it('lists root markdown as docs, excluding the four instruction files', async () => {
    const root = await tempDir();
    for (const name of ['README.md', 'notes.md', 'CLAUDE.md', 'AGENTS.md', 'VIBEBOARD.md', 'INSTRUCTIONS.md'])
      await writeFile(join(root, name), '# x\n', 'utf8');
    await writeFile(join(root, 'todo.txt'), 'x', 'utf8'); // not markdown
    await mkdir(join(root, 'looks.md'), { recursive: true }); // a directory, not a file

    const groups = await listControlFiles(root);
    const docs = groups.find((g) => g.key === 'docs')!;
    expect(docs.files.map((f) => f.path)).toEqual(['README.md', 'notes.md']);
    // The instruction files appear once, in their own group, and are never deletable.
    const instructions = groups.find((g) => g.key === 'instructions')!;
    expect(instructions.files.map((f) => f.path)).toEqual([
      'INSTRUCTIONS.md',
      'CLAUDE.md',
      'AGENTS.md',
      'VIBEBOARD.md',
    ]);
    expect(instructions.files.every((f) => f.deletable)).toBe(false);
  });

  it('omits an instruction file that does not exist on disk', async () => {
    const root = await tempDir();
    await writeFile(join(root, 'CLAUDE.md'), '# x\n', 'utf8');
    const instructions = (await listControlFiles(root)).find((g) => g.key === 'instructions')!;
    expect(instructions.files.map((f) => f.path)).toEqual(['CLAUDE.md']);
  });

  it('walks docs and skills recursively, sorted, and names a skill by its folder', async () => {
    const root = await tempDir();
    await mkdir(join(root, 'docs', 'deep'), { recursive: true });
    await writeFile(join(root, 'docs', 'b.md'), 'x', 'utf8');
    await writeFile(join(root, 'docs', 'a.md'), 'x', 'utf8');
    await writeFile(join(root, 'docs', 'deep', 'c.md'), 'x', 'utf8');
    await mkdir(join(root, '.claude', 'skills', 'zeta'), { recursive: true });
    await writeFile(join(root, '.claude', 'skills', 'zeta', 'SKILL.md'), 'x', 'utf8');

    const groups = await listControlFiles(root);
    expect(groups.find((g) => g.key === 'docs')!.files.map((f) => f.path)).toEqual([
      'docs/a.md',
      'docs/b.md',
      'docs/deep/c.md',
    ]);
    const skills = groups.find((g) => g.key === 'skills')!.files;
    // Every skill's file is literally SKILL.md, so the folder is the display name.
    expect(skills.map((f) => f.name)).toEqual(['zeta']);
    expect(skills[0].path).toBe('.claude/skills/zeta/SKILL.md');
  });

  it('returns four labelled groups, all empty, for a bare directory', async () => {
    const groups = await listControlFiles(await tempDir());
    expect(groups.map((g) => [g.key, g.label])).toEqual([
      ['instructions', 'Instructions'],
      ['skills', 'Skills'],
      ['docs', 'Docs'],
      ['resources', 'Resources'],
    ]);
    expect(groups.every((g) => g.files.length === 0)).toBe(true);
  });

  it('marks only the VibeBoard-managed instruction files as managed', async () => {
    const root = await tempDir();
    for (const n of ['INSTRUCTIONS.md', 'CLAUDE.md', 'AGENTS.md', 'VIBEBOARD.md'])
      await writeFile(join(root, n), 'x', 'utf8');
    const files = (await listControlFiles(root)).find((g) => g.key === 'instructions')!.files;
    expect(files.filter((f) => f.managed).map((f) => f.path)).toEqual([
      'CLAUDE.md',
      'AGENTS.md',
      'VIBEBOARD.md',
    ]);
  });

  it('reads a control file that does not exist yet as empty rather than failing', async () => {
    const file = await readControlFile(await tempDir(), 'docs/never-written.md');
    expect(file).toMatchObject({ path: 'docs/never-written.md', content: '' });
  });
});

describe('control-files naming', () => {
  it.each([
    ['docs', 'docs/new-doc.md'],
    ['resources', 'resources/new-resource.md'],
    ['skills', '.claude/skills/new-skill/SKILL.md'],
  ])('creates a %s at %s', async (category, path) => {
    expect((await createControlFile(await tempDir(), category))?.path).toBe(path);
  });

  it.each(['instructions', 'bogus', '', null, undefined, 42])('refuses category %p', async (category) => {
    expect(await createControlFile(await tempDir(), category)).toBeNull();
  });

  it('counts up only from the second name, and treats a skill folder as occupied', async () => {
    const root = await tempDir();
    expect((await createControlFile(root, 'docs'))?.path).toBe('docs/new-doc.md');
    expect((await createControlFile(root, 'docs'))?.path).toBe('docs/new-doc-2.md');
    expect((await createControlFile(root, 'docs'))?.path).toBe('docs/new-doc-3.md');
    // Skills collide on the FOLDER, not the file.
    expect((await createControlFile(root, 'skills'))?.path).toBe('.claude/skills/new-skill/SKILL.md');
    expect((await createControlFile(root, 'skills'))?.path).toBe('.claude/skills/new-skill-2/SKILL.md');
  });

  it('gives a new skill frontmatter whose name mirrors its folder, and a doc just a heading', async () => {
    const root = await tempDir();
    await createControlFile(root, 'skills');
    const skill = await readControlFile(root, '.claude/skills/new-skill/SKILL.md');
    expect(skill!.content).toBe(
      '---\nname: new-skill\ndescription: What this skill does and when to use it.\n---\n\n# New skill\n\nDescribe the steps here.\n',
    );

    await createControlFile(root, 'docs');
    expect((await readControlFile(root, 'docs/new-doc.md'))!.content).toBe('# New doc\n\n');
  });

  it.each([
    ['Design Notes', 'docs/design-notes.md'],
    ['Design Notes.md', 'docs/design-notes.md'],
    ['Design Notes.MD', 'docs/design-notes.md'],
    ['  Spaced  Out  ', 'docs/spaced-out.md'],
  ])('renames to %s -> %s', async (name, expected) => {
    const root = await tempDir();
    await createControlFile(root, 'docs');
    expect((await renameControlFile(root, 'docs/new-doc.md', name)) as { path: string }).toMatchObject({
      path: expected,
    });
  });

  it.each(['', '   ', '///', '.md', null, 42])('refuses the new name %p', async (name) => {
    const root = await tempDir();
    await createControlFile(root, 'docs');
    expect(await renameControlFile(root, 'docs/new-doc.md', name)).toBeNull();
  });

  it('treats a rename to the same slug as a no-op rather than a collision', async () => {
    const root = await tempDir();
    await createControlFile(root, 'docs');
    // "New doc" already lives at docs/new-doc.md — same target, so not 'taken'.
    expect((await renameControlFile(root, 'docs/new-doc.md', 'New doc')) as { path: string }).toMatchObject({
      path: 'docs/new-doc.md',
    });
  });

  it('keeps a skill frontmatter name in step, but never overwrites one the user chose', async () => {
    const root = await tempDir();
    await createControlFile(root, 'skills');
    await renameControlFile(root, '.claude/skills/new-skill/SKILL.md', 'Deploy steps');
    const moved = await readControlFile(root, '.claude/skills/deploy-steps/SKILL.md');
    expect(moved!.content).toContain('name: deploy-steps');

    // A hand-chosen name no longer matches the folder, so a later rename must leave it alone.
    await writeControlFile(root, '.claude/skills/deploy-steps/SKILL.md', '---\nname: mine\n---\n');
    await renameControlFile(root, '.claude/skills/deploy-steps/SKILL.md', 'Ship it');
    expect((await readControlFile(root, '.claude/skills/ship-it/SKILL.md'))!.content).toContain('name: mine');
  });
});

describe('control-files resources registry', () => {
  it.each([
    [
      { title: '  Ref  ', url: '  https://x.dev  ' },
      { title: 'Ref', url: 'https://x.dev' },
    ],
    [
      { title: 'T', url: 'u', note: '  n  ' },
      { title: 'T', url: 'u', note: 'n' },
    ],
    [
      { title: 'T', url: 'u', note: '   ' },
      { title: 'T', url: 'u' },
    ],
    [{ title: 'only title' }, { title: 'only title', url: '' }],
    [{ url: 'only url' }, { title: '', url: 'only url' }],
  ])('cleans %o', async (input, expected) => {
    const root = await tempDir();
    await writeResources(root, [input]);
    expect(await readResources(root)).toEqual([expected]);
  });

  it.each([[{}], ['a string'], [42], [null], [[]], [{ title: '  ', url: '  ' }], [{ note: 'orphan' }]])(
    'drops the unusable entry %p',
    async (input) => {
      const root = await tempDir();
      await writeResources(root, [input]);
      expect(await readResources(root)).toEqual([]);
    },
  );

  it('writes an empty registry when handed something that is not an array', async () => {
    const root = await tempDir();
    await writeResources(root, 'nonsense' as unknown as unknown[]);
    expect(await readResources(root)).toEqual([]);
  });

  it('reads an empty list when the yaml has no usable links key', async () => {
    const root = await tempDir();
    await mkdir(join(root, '.vibeboard'), { recursive: true });
    for (const yaml of ['links: not-a-list\n', 'other: 1\n', 'null\n', '[]\n']) {
      await writeFile(join(root, '.vibeboard', 'resources.yaml'), yaml, 'utf8');
      expect(await readResources(root), yaml).toEqual([]);
    }
  });
});

describe('control-files listing filters and ordering', () => {
  it('drops files under docs/ and resources/ that are not control documents', async () => {
    const root = await tempDir();
    await mkdir(join(root, 'docs'), { recursive: true });
    await mkdir(join(root, 'resources'), { recursive: true });
    await writeFile(join(root, 'docs', 'real.md'), 'x', 'utf8');
    await writeFile(join(root, 'docs', 'diagram.png'), 'x', 'utf8');
    await writeFile(join(root, 'resources', 'notes.md'), 'x', 'utf8');
    await writeFile(join(root, 'resources', 'blob.bin'), 'x', 'utf8');

    const groups = await listControlFiles(root);
    // A descriptor-less path must be dropped, not carried through as a null entry. Note the
    // deliberate asymmetry: docs/ is markdown-only, but resources/ takes any file, because
    // reference material is not necessarily markdown.
    expect(groups.find((g) => g.key === 'docs')!.files.map((f) => f.path)).toEqual(['docs/real.md']);
    expect(groups.find((g) => g.key === 'resources')!.files.map((f) => f.path)).toEqual([
      'resources/blob.bin',
      'resources/notes.md',
    ]);
    expect(groups.every((g) => g.files.every((f) => f !== null))).toBe(true);
  });

  it('sorts listings by path, not by the order the filesystem hands them over', async () => {
    const root = await tempDir();
    await mkdir(join(root, 'docs'), { recursive: true });
    // Written deliberately in reverse.
    for (const n of ['zulu.md', 'mike.md', 'alpha.md']) await writeFile(join(root, 'docs', n), 'x', 'utf8');
    for (const n of ['zebra.md', 'middle.md', 'apple.md']) await writeFile(join(root, n), 'x', 'utf8');

    const groups = await listControlFiles(root);
    expect(groups.find((g) => g.key === 'docs')!.files.map((f) => f.path)).toEqual([
      'apple.md',
      'middle.md',
      'zebra.md',
      'docs/alpha.md',
      'docs/mike.md',
      'docs/zulu.md',
    ]);
  });

  it('scopes the docs and skills walks to their own folders', async () => {
    const root = await tempDir();
    await mkdir(join(root, 'docs'), { recursive: true });
    await mkdir(join(root, '.claude', 'skills', 'one'), { recursive: true });
    await writeFile(join(root, 'docs', 'd.md'), 'x', 'utf8');
    await writeFile(join(root, '.claude', 'skills', 'one', 'SKILL.md'), 'x', 'utf8');
    await writeFile(join(root, 'CLAUDE.md'), 'x', 'utf8');

    const groups = await listControlFiles(root);
    // A walk rooted anywhere wider would pull CLAUDE.md or the skill into the docs group.
    expect(groups.find((g) => g.key === 'docs')!.files.map((f) => f.path)).toEqual(['docs/d.md']);
    expect(groups.find((g) => g.key === 'skills')!.files.map((f) => f.path)).toEqual([
      '.claude/skills/one/SKILL.md',
    ]);
  });
});

describe('control-files resources persistence', () => {
  it('keeps the good entries and drops the bad ones from a mixed list', async () => {
    const root = await tempDir();
    await mkdir(join(root, '.vibeboard'), { recursive: true });
    await writeFile(
      join(root, '.vibeboard', 'resources.yaml'),
      'links:\n  - title: Good\n    url: https://x.dev\n  - junk\n  - null\n  - title: "  "\n    url: "  "\n',
      'utf8',
    );
    // A survivor of the shape [entry, null] would come back with a hole in it.
    expect(await readResources(root)).toEqual([{ title: 'Good', url: 'https://x.dev' }]);
  });

  it('never writes a hole into the yaml for an entry it rejected', async () => {
    const root = await tempDir();
    await writeResources(root, [{ title: 'Keep', url: 'u' }, 'junk', null, 42, {}]);
    const yaml = await readFile(join(root, '.vibeboard', 'resources.yaml'), 'utf8');
    expect(yaml).toBe('links:\n  - title: Keep\n    url: u\n');
  });

  it('writes an empty list rather than failing when handed no array at all', async () => {
    const root = await tempDir();
    await writeResources(root, undefined as unknown as unknown[]);
    expect(await readFile(join(root, '.vibeboard', 'resources.yaml'), 'utf8')).toBe('links: []\n');
  });
});
