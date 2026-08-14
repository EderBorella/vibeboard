import { mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  boardRel,
  CHAT_DIR,
  CONFIG_DIR,
  CONFIG_FILE,
  CONVENTIONS_FILE,
  DOCS_DIR,
  FOUNDATION_DIR,
  INSTRUCTIONS_FILE,
  POINTER_FILES,
  RESOURCES_DIR,
  RESOURCES_YAML,
  SKILLS_DIR,
  skillRel,
} from '../src/core/layout.js';
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
} from '../src/store/project/control-files.js';
import { tempDir } from './helpers.js';

const [CLAUDE_MD, AGENTS_MD] = POINTER_FILES;

// The allow-list in categoryOf runs on the path AS GIVEN, before anything is resolved. So the
// dangerous shape is a traversal that normalises back inside the root: it satisfies the allow-list
// under one category and lands on a file governed by another. `<docs>/../VIBEBOARD.md` classifies as
// `docs` — deletable — while VIBEBOARD.md is an instruction file that must never be deletable.
// Removing the `..` guard leaves the whole suite green, so this is its only witness.
describe('control-files traversal that normalises back inside the root', () => {
  it.each([
    `${DOCS_DIR}/../../${CLAUDE_MD}`,
    `${DOCS_DIR}/../INSTRUCTIONS.md`,
    `${DOCS_DIR}/../VIBEBOARD.md`,
    `${DOCS_DIR}/../skills/x/SKILL.md`,
    `${DOCS_DIR}/../docs/notes.md`,
    `${DOCS_DIR}/./../docs/notes.md`,
    `${RESOURCES_DIR}/../../${CLAUDE_MD}`,
  ])('refuses %s', async (bad) => {
    expect(await resolveControlPath(await tempDir(), bad)).toBeNull();
  });

  it('does not let a traversal borrow a deletable category to reach a protected file', async () => {
    const root = await tempDir();
    await writeFile(join(root, CLAUDE_MD), '# managed\n', 'utf8');

    // Were this allowed it would resolve to CLAUDE.md while describing itself as a doc, and
    // deletable: true would let the delete route remove a file the UI protects.
    const bad = `${DOCS_DIR}/../../${CLAUDE_MD}`;
    expect(await resolveControlPath(root, bad)).toBeNull();
    expect(await deleteControlFile(root, bad)).toBe('invalid');
    expect(await readFile(join(root, CLAUDE_MD), 'utf8')).toBe('# managed\n');
  });

  it('refuses a non-string path instead of throwing', async () => {
    const root = await tempDir();
    for (const bad of [null, undefined, 123, {}, [], true]) {
      expect(await resolveControlPath(root, bad), String(bad)).toBeNull();
    }
  });

  it('fails closed when the project root itself cannot be resolved', async () => {
    expect(await resolveControlPath(join(await tempDir(), 'gone'), `${DOCS_DIR}/x.md`)).toBeNull();
  });

  // Now that the control documents live inside the config folder too, "everything under
  // `.vibeboard/` is off-limits" can no longer be the first rule — it has to run after the
  // allow-list, or the whole tab classifies as null. These are the paths it still has to refuse.
  it('allows the resources registry but nothing else under the config dir', async () => {
    const root = await tempDir();
    expect(await resolveControlPath(root, RESOURCES_YAML)).not.toBeNull();
    for (const bad of [
      `${CONFIG_DIR}/${CONFIG_FILE}`,
      `${CHAT_DIR}/a.json`,
      `${CONFIG_DIR}/notes.md`,
      boardRel('product', 'todo', 'P-001.md'),
    ]) {
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
      `${CONFIG_DIR}/${CONFIG_FILE}`,
      `${CHAT_DIR}/x.json`,
      boardRel('features', 'todo', 'F-001.md'), // a card
      'secret.txt', // root, and not a control document
      'README.md', // root markdown: the project's own, not VibeBoard's
      `${DOCS_DIR}/nested/pic.png`, // docs but not markdown
      '',
    ]) {
      expect(await resolveControlPath(root, bad), bad).toBeNull();
    }
  });

  it('accepts the allow-listed control paths', async () => {
    const root = await tempDir();
    for (const ok of [
      INSTRUCTIONS_FILE,
      CLAUDE_MD,
      CONVENTIONS_FILE,
      `${DOCS_DIR}/design.md`,
      skillRel('foo', 'SKILL.md'),
      `${RESOURCES_DIR}/api-notes.md`,
      RESOURCES_YAML,
    ]) {
      const r = await resolveControlPath(root, ok);
      expect(r, ok).not.toBeNull();
      expect(r!.file.path).toBe(ok);
    }
  });

  it('flags managed + non-deletable for the three managed files only', async () => {
    const root = await tempDir();
    const claude = await resolveControlPath(root, CLAUDE_MD);
    expect(claude!.file).toMatchObject({ managed: true, deletable: false });
    const ins = await resolveControlPath(root, INSTRUCTIONS_FILE);
    expect(ins!.file).toMatchObject({ managed: false, deletable: false }); // instruction files never deletable
    const doc = await resolveControlPath(root, `${DOCS_DIR}/x.md`);
    expect(doc!.file).toMatchObject({ managed: false, deletable: true });
  });

  it('rejects a symlink that escapes the project root', async () => {
    const root = await tempDir();
    const outside = await tempDir();
    await writeFile(join(outside, 'target.md'), 'secret', 'utf8');
    await mkdir(join(root, RESOURCES_DIR), { recursive: true });
    await symlink(join(outside, 'target.md'), join(root, RESOURCES_DIR, 'evil.md'));
    expect(await resolveControlPath(root, `${RESOURCES_DIR}/evil.md`)).toBeNull();
  });
});

describe('control-files CRUD', () => {
  it('creates, lists, reads, and deletes a doc', async () => {
    const root = await tempDir();
    const design = `${DOCS_DIR}/design.md`;
    expect(await writeControlFile(root, design, '# Design\n')).toBe(true);

    const groups = await listControlFiles(root);
    const docs = groups.find((g) => g.key === 'docs')!;
    expect(docs.files.map((f) => f.path)).toContain(design);

    const read = await readControlFile(root, design);
    expect(read!.content).toBe('# Design\n');

    expect(await deleteControlFile(root, design)).toBe('ok');
    const after = await listControlFiles(root);
    expect(after.find((g) => g.key === 'docs')!.files.map((f) => f.path)).not.toContain(design);
  });

  it('creates skills nested and refuses to delete an instruction file', async () => {
    const root = await tempDir();
    await writeControlFile(root, skillRel('greet', 'SKILL.md'), 'skill');
    const skills = (await listControlFiles(root)).find((g) => g.key === 'skills')!;
    expect(skills.files.map((f) => f.path)).toContain(skillRel('greet', 'SKILL.md'));

    await writeControlFile(root, CLAUDE_MD, 'managed');
    expect(await deleteControlFile(root, CLAUDE_MD)).toBe('not-allowed');
    expect(await readFile(join(root, CLAUDE_MD), 'utf8')).toBe('managed'); // untouched
  });

  it('takes the skill folder with SKILL.md when nothing else is in it', async () => {
    // The bug this fixes: the folder survived, readSkills saw a directory with no SKILL.md, and
    // every card's rail warned about it — with no file for Project Control to select, so nothing
    // could clear the warning.
    const root = await tempDir();
    await writeControlFile(root, skillRel('greet', 'SKILL.md'), 'skill');

    expect(await deleteControlFile(root, skillRel('greet', 'SKILL.md'))).toBe('ok');
    await expect(readdir(join(root, skillRel('greet')))).rejects.toThrow();
    // The skills root itself is untouched — only the one folder went.
    expect(await readdir(join(root, SKILLS_DIR))).toEqual([]);
  });

  it('leaves a skill folder that still holds something the user put there', async () => {
    // Deleting SKILL.md is not permission to delete a script beside it. The folder then simply is
    // not a skill any more, and the catalogue ignores it.
    const root = await tempDir();
    await writeControlFile(root, skillRel('greet', 'SKILL.md'), 'skill');
    await writeFile(join(root, skillRel('greet', 'run.sh')), '#!/bin/sh\n', 'utf8');

    expect(await deleteControlFile(root, skillRel('greet', 'SKILL.md'))).toBe('ok');
    expect(await readdir(join(root, skillRel('greet')))).toEqual(['run.sh']);
  });

  it('removes no directory when the deleted file is nested inside a skill', async () => {
    const root = await tempDir();
    await writeControlFile(root, skillRel('greet', 'SKILL.md'), 'skill');
    await mkdir(join(root, skillRel('greet', 'scripts')), { recursive: true });
    await writeFile(join(root, skillRel('greet', 'scripts', 'a.sh')), 'x', 'utf8');

    expect(await deleteControlFile(root, skillRel('greet', 'scripts', 'a.sh'))).toBe('ok');
    // The scripts folder is now empty, and stays: only a skill's own SKILL.md takes a folder.
    expect(await readdir(join(root, skillRel('greet', 'scripts')))).toEqual([]);
    expect(await readdir(join(root, skillRel('greet')))).toContain('SKILL.md');
  });

  it('takes no folder when the last file in a skill folder is not SKILL.md', async () => {
    // Only SKILL.md carries the skill's identity. Deleting a stray note that happens to be the last
    // thing in the folder must not take the folder with it — the user made that folder on purpose,
    // and it is theirs until they say otherwise.
    const root = await tempDir();
    await writeControlFile(root, skillRel('greet', 'notes.md'), 'just a note');

    expect(await deleteControlFile(root, skillRel('greet', 'notes.md'))).toBe('ok');
    expect(await readdir(join(root, skillRel('greet')))).toEqual([]);
  });

  it('takes no folder when a doc is deleted', async () => {
    const root = await tempDir();
    await writeControlFile(root, `${DOCS_DIR}/notes.md`, '# n');
    expect(await deleteControlFile(root, `${DOCS_DIR}/notes.md`)).toBe('ok');
    expect(await readdir(join(root, DOCS_DIR))).toEqual([]);
  });

  it('write/read/delete reject non-control paths', async () => {
    const root = await tempDir();
    expect(await writeControlFile(root, '../escape.md', 'x')).toBe(false);
    expect(await readControlFile(root, `${CONFIG_DIR}/${CONFIG_FILE}`)).toBeNull();
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
      `${DOCS_DIR}/new-doc.md`,
      `${DOCS_DIR}/new-doc-2.md`,
      `${DOCS_DIR}/new-doc-3.md`,
    ]);
    // and they really exist on disk, independently
    for (const f of [a, b, c]) expect((await readControlFile(root, f!.path))!.content).toContain('#');
  });

  it('creates a skill as a folder holding SKILL.md, with discoverable frontmatter', async () => {
    const root = await tempDir();
    const s = await createControlFile(root, 'skills');
    expect(s!.path).toBe(skillRel('new-skill', 'SKILL.md'));
    expect(s!.name).toBe('new-skill'); // the folder, not "SKILL.md"
    const { content } = (await readControlFile(root, s!.path))!;
    expect(content).toMatch(/^---\nname: new-skill\ndescription:/);
  });

  it('numbers skills too, since the folder is what collides', async () => {
    const root = await tempDir();
    await createControlFile(root, 'skills');
    const second = await createControlFile(root, 'skills');
    expect(second!.path).toBe(skillRel('new-skill-2', 'SKILL.md'));
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
    expect((renamed as { path: string }).path).toBe(`${DOCS_DIR}/design-notes.md`);
    expect(await readControlFile(root, doc!.path)).toMatchObject({ content: '' }); // old path gone
    const files = (await listControlFiles(root)).find((g) => g.key === 'docs')!.files;
    expect(files.map((f) => f.path)).toEqual([`${DOCS_DIR}/design-notes.md`]);
  });

  it('renames a skill by moving its folder and syncing the frontmatter name', async () => {
    const root = await tempDir();
    const skill = await createControlFile(root, 'skills');
    const renamed = await renameControlFile(root, skill!.path, 'Greet the user');
    expect((renamed as { path: string }).path).toBe(skillRel('greet-the-user', 'SKILL.md'));
    const { content } = (await readControlFile(root, skillRel('greet-the-user', 'SKILL.md')))!;
    expect(content).toContain('name: greet-the-user'); // frontmatter followed the folder
    expect(content).not.toContain('name: new-skill');
  });

  it('leaves a hand-picked frontmatter name alone', async () => {
    const root = await tempDir();
    const skill = await createControlFile(root, 'skills');
    await writeControlFile(root, skill!.path, '---\nname: my-own-choice\n---\nbody\n');
    await renameControlFile(root, skill!.path, 'Renamed');
    const { content } = (await readControlFile(root, skillRel('renamed', 'SKILL.md')))!;
    expect(content).toContain('name: my-own-choice');
  });

  it('tolerates a typed .md extension instead of slugging it into the name', async () => {
    const root = await tempDir();
    const doc = await createControlFile(root, 'docs');
    const renamed = await renameControlFile(root, doc!.path, 'Design Notes.md');
    expect((renamed as { path: string }).path).toBe(`${DOCS_DIR}/design-notes.md`); // not design-notes-md.md
  });

  it('reports a collision instead of clobbering', async () => {
    const root = await tempDir();
    const a = await createControlFile(root, 'docs');
    await renameControlFile(root, a!.path, 'Taken');
    const b = await createControlFile(root, 'docs');
    expect(await renameControlFile(root, b!.path, 'Taken')).toBe('taken');
    // both still present
    const files = (await listControlFiles(root)).find((g) => g.key === 'docs')!.files;
    expect(files.map((f) => f.path).sort()).toEqual([`${DOCS_DIR}/new-doc.md`, `${DOCS_DIR}/taken.md`]);
  });

  it('rejects instruction files, empty names, and paths outside the sandbox', async () => {
    const root = await tempDir();
    await writeControlFile(root, INSTRUCTIONS_FILE, 'x');
    expect(await renameControlFile(root, INSTRUCTIONS_FILE, 'Nope')).toBeNull();
    const doc = await createControlFile(root, 'docs');
    expect(await renameControlFile(root, doc!.path, '   ')).toBeNull();
    expect(await renameControlFile(root, '../escape.md', 'Nope')).toBeNull();
  });
});

describe('resources registry', () => {
  it('round-trips links and drops empty/garbage entries', async () => {
    const root = await tempDir();
    await mkdir(join(root, CONFIG_DIR), { recursive: true });
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
  // Root markdown used to be listed as docs, because `docs/` and the two documents were at the root
  // too. Now that everything VibeBoard owns is inside `.vibeboard/`, a repo's own README is not one
  // of the documents this tab steers — only `<config>/docs/**.md` is.
  it('lists only the docs folder as docs, and the four instruction files in their own group', async () => {
    const root = await tempDir();
    for (const rel of [INSTRUCTIONS_FILE, CLAUDE_MD, AGENTS_MD, CONVENTIONS_FILE, `${DOCS_DIR}/notes.md`]) {
      await mkdir(join(root, rel, '..'), { recursive: true });
      await writeFile(join(root, rel), '# x\n', 'utf8');
    }
    await writeFile(join(root, 'README.md'), '# the project', 'utf8'); // the repo's own, not ours
    await writeFile(join(root, DOCS_DIR, 'todo.txt'), 'x', 'utf8'); // not markdown
    await mkdir(join(root, DOCS_DIR, 'looks.md'), { recursive: true }); // a directory, not a file

    const groups = await listControlFiles(root);
    const docs = groups.find((g) => g.key === 'docs')!;
    expect(docs.files.map((f) => f.path)).toEqual([`${DOCS_DIR}/notes.md`]);
    // The instruction files appear once, in their own group, and are never deletable.
    const instructions = groups.find((g) => g.key === 'instructions')!;
    expect(instructions.files.map((f) => f.path)).toEqual([
      INSTRUCTIONS_FILE,
      CLAUDE_MD,
      AGENTS_MD,
      CONVENTIONS_FILE,
    ]);
    expect(instructions.files.every((f) => f.deletable)).toBe(false);
  });

  it('omits an instruction file that does not exist on disk', async () => {
    const root = await tempDir();
    await writeFile(join(root, CLAUDE_MD), '# x\n', 'utf8');
    const instructions = (await listControlFiles(root)).find((g) => g.key === 'instructions')!;
    expect(instructions.files.map((f) => f.path)).toEqual([CLAUDE_MD]);
  });

  it('walks docs and skills recursively, sorted, and names a skill by its folder', async () => {
    const root = await tempDir();
    await mkdir(join(root, DOCS_DIR, 'deep'), { recursive: true });
    await writeFile(join(root, DOCS_DIR, 'b.md'), 'x', 'utf8');
    await writeFile(join(root, DOCS_DIR, 'a.md'), 'x', 'utf8');
    await writeFile(join(root, DOCS_DIR, 'deep', 'c.md'), 'x', 'utf8');
    await mkdir(join(root, skillRel('zeta')), { recursive: true });
    await writeFile(join(root, skillRel('zeta', 'SKILL.md')), 'x', 'utf8');

    const groups = await listControlFiles(root);
    expect(groups.find((g) => g.key === 'docs')!.files.map((f) => f.path)).toEqual([
      `${DOCS_DIR}/a.md`,
      `${DOCS_DIR}/b.md`,
      `${DOCS_DIR}/deep/c.md`,
    ]);
    const skills = groups.find((g) => g.key === 'skills')!.files;
    // Every skill's file is literally SKILL.md, so the folder is the display name.
    expect(skills.map((f) => f.name)).toEqual(['zeta']);
    expect(skills[0].path).toBe(skillRel('zeta', 'SKILL.md'));
  });

  it('returns five labelled groups for a bare directory, empty but for the fixed foundation set', async () => {
    const groups = await listControlFiles(await tempDir());
    expect(groups.map((g) => [g.key, g.label])).toEqual([
      ['instructions', 'Instructions'],
      ['foundation', 'Foundation'],
      ['skills', 'Skills'],
      ['docs', 'Docs'],
      ['resources', 'Resources'],
    ]);
    // Foundation is the one group listed before its files exist, so that a missing document is
    // something a person can click. Everything else appears only once there is a file.
    expect(groups.filter((g) => g.files.length > 0).map((g) => g.key)).toEqual(['foundation']);
  });

  it('marks only the VibeBoard-managed instruction files as managed', async () => {
    const root = await tempDir();
    for (const rel of [INSTRUCTIONS_FILE, CLAUDE_MD, AGENTS_MD, CONVENTIONS_FILE]) {
      await mkdir(join(root, rel, '..'), { recursive: true });
      await writeFile(join(root, rel), 'x', 'utf8');
    }
    const files = (await listControlFiles(root)).find((g) => g.key === 'instructions')!.files;
    expect(files.filter((f) => f.managed).map((f) => f.path)).toEqual([
      CLAUDE_MD,
      AGENTS_MD,
      CONVENTIONS_FILE,
    ]);
  });

  it('reads a control file that does not exist yet as empty rather than failing', async () => {
    const file = await readControlFile(await tempDir(), `${DOCS_DIR}/never-written.md`);
    expect(file).toMatchObject({ path: `${DOCS_DIR}/never-written.md`, content: '' });
  });
});

describe('control-files naming', () => {
  it.each([
    ['docs', `${DOCS_DIR}/new-doc.md`],
    ['resources', `${RESOURCES_DIR}/new-resource.md`],
    ['skills', skillRel('new-skill', 'SKILL.md')],
  ])('creates a %s at %s', async (category, path) => {
    expect((await createControlFile(await tempDir(), category))?.path).toBe(path);
  });

  it.each(['instructions', 'bogus', '', null, undefined, 42])('refuses category %p', async (category) => {
    expect(await createControlFile(await tempDir(), category)).toBeNull();
  });

  it('counts up only from the second name, and treats a skill folder as occupied', async () => {
    const root = await tempDir();
    expect((await createControlFile(root, 'docs'))?.path).toBe(`${DOCS_DIR}/new-doc.md`);
    expect((await createControlFile(root, 'docs'))?.path).toBe(`${DOCS_DIR}/new-doc-2.md`);
    expect((await createControlFile(root, 'docs'))?.path).toBe(`${DOCS_DIR}/new-doc-3.md`);
    // Skills collide on the FOLDER, not the file.
    expect((await createControlFile(root, 'skills'))?.path).toBe(skillRel('new-skill', 'SKILL.md'));
    expect((await createControlFile(root, 'skills'))?.path).toBe(skillRel('new-skill-2', 'SKILL.md'));
  });

  it('gives a new skill frontmatter whose name mirrors its folder, and a doc just a heading', async () => {
    const root = await tempDir();
    await createControlFile(root, 'skills');
    const skill = await readControlFile(root, skillRel('new-skill', 'SKILL.md'));
    expect(skill!.content).toBe(
      '---\nname: new-skill\ndescription: What this skill does and when to use it.\n---\n\n# New skill\n\nDescribe the steps here.\n',
    );

    await createControlFile(root, 'docs');
    expect((await readControlFile(root, `${DOCS_DIR}/new-doc.md`))!.content).toBe('# New doc\n\n');
  });

  it.each([
    ['Design Notes', `${DOCS_DIR}/design-notes.md`],
    ['Design Notes.md', `${DOCS_DIR}/design-notes.md`],
    ['Design Notes.MD', `${DOCS_DIR}/design-notes.md`],
    ['  Spaced  Out  ', `${DOCS_DIR}/spaced-out.md`],
  ])('renames to %s -> %s', async (name, expected) => {
    const root = await tempDir();
    await createControlFile(root, 'docs');
    expect((await renameControlFile(root, `${DOCS_DIR}/new-doc.md`, name)) as { path: string }).toMatchObject(
      { path: expected },
    );
  });

  it.each(['', '   ', '///', '.md', null, 42])('refuses the new name %p', async (name) => {
    const root = await tempDir();
    await createControlFile(root, 'docs');
    expect(await renameControlFile(root, `${DOCS_DIR}/new-doc.md`, name)).toBeNull();
  });

  it('treats a rename to the same slug as a no-op rather than a collision', async () => {
    const root = await tempDir();
    await createControlFile(root, 'docs');
    // "New doc" already lives at <docs>/new-doc.md — same target, so not 'taken'.
    expect(
      (await renameControlFile(root, `${DOCS_DIR}/new-doc.md`, 'New doc')) as { path: string },
    ).toMatchObject({ path: `${DOCS_DIR}/new-doc.md` });
  });

  it('keeps a skill frontmatter name in step, but never overwrites one the user chose', async () => {
    const root = await tempDir();
    await createControlFile(root, 'skills');
    await renameControlFile(root, skillRel('new-skill', 'SKILL.md'), 'Deploy steps');
    const moved = await readControlFile(root, skillRel('deploy-steps', 'SKILL.md'));
    expect(moved!.content).toContain('name: deploy-steps');

    // A hand-chosen name no longer matches the folder, so a later rename must leave it alone.
    await writeControlFile(root, skillRel('deploy-steps', 'SKILL.md'), '---\nname: mine\n---\n');
    await renameControlFile(root, skillRel('deploy-steps', 'SKILL.md'), 'Ship it');
    expect((await readControlFile(root, skillRel('ship-it', 'SKILL.md')))!.content).toContain('name: mine');
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
    await mkdir(join(root, CONFIG_DIR), { recursive: true });
    for (const yaml of ['links: not-a-list\n', 'other: 1\n', 'null\n', '[]\n']) {
      await writeFile(join(root, RESOURCES_YAML), yaml, 'utf8');
      expect(await readResources(root), yaml).toEqual([]);
    }
  });
});

describe('control-files listing filters and ordering', () => {
  it('drops files under docs/ and resources/ that are not control documents', async () => {
    const root = await tempDir();
    await mkdir(join(root, DOCS_DIR), { recursive: true });
    await mkdir(join(root, RESOURCES_DIR), { recursive: true });
    await writeFile(join(root, DOCS_DIR, 'real.md'), 'x', 'utf8');
    await writeFile(join(root, DOCS_DIR, 'diagram.png'), 'x', 'utf8');
    await writeFile(join(root, RESOURCES_DIR, 'notes.md'), 'x', 'utf8');
    await writeFile(join(root, RESOURCES_DIR, 'blob.bin'), 'x', 'utf8');

    const groups = await listControlFiles(root);
    // A descriptor-less path must be dropped, not carried through as a null entry. Note the
    // deliberate asymmetry: docs/ is markdown-only, but resources/ takes any file, because
    // reference material is not necessarily markdown.
    expect(groups.find((g) => g.key === 'docs')!.files.map((f) => f.path)).toEqual([`${DOCS_DIR}/real.md`]);
    expect(groups.find((g) => g.key === 'resources')!.files.map((f) => f.path)).toEqual([
      `${RESOURCES_DIR}/blob.bin`,
      `${RESOURCES_DIR}/notes.md`,
    ]);
    expect(groups.every((g) => g.files.every((f) => f !== null))).toBe(true);
  });

  it('sorts listings by path, not by the order the filesystem hands them over', async () => {
    const root = await tempDir();
    await mkdir(join(root, DOCS_DIR, 'deep'), { recursive: true });
    // Written deliberately in reverse, and across two levels so the sort has to span both.
    for (const n of ['zulu.md', 'mike.md', 'alpha.md']) await writeFile(join(root, DOCS_DIR, n), 'x', 'utf8');
    for (const n of ['zebra.md', 'middle.md', 'apple.md'])
      await writeFile(join(root, DOCS_DIR, 'deep', n), 'x', 'utf8');

    const groups = await listControlFiles(root);
    expect(groups.find((g) => g.key === 'docs')!.files.map((f) => f.path)).toEqual([
      `${DOCS_DIR}/alpha.md`,
      `${DOCS_DIR}/deep/apple.md`,
      `${DOCS_DIR}/deep/middle.md`,
      `${DOCS_DIR}/deep/zebra.md`,
      `${DOCS_DIR}/mike.md`,
      `${DOCS_DIR}/zulu.md`,
    ]);
  });

  it('scopes the docs and skills walks to their own folders', async () => {
    const root = await tempDir();
    await mkdir(join(root, DOCS_DIR), { recursive: true });
    await mkdir(join(root, skillRel('one')), { recursive: true });
    await writeFile(join(root, DOCS_DIR, 'd.md'), 'x', 'utf8');
    await writeFile(join(root, skillRel('one', 'SKILL.md')), 'x', 'utf8');
    await writeFile(join(root, CLAUDE_MD), 'x', 'utf8');

    const groups = await listControlFiles(root);
    // Docs and skills are now siblings inside the config folder, so a walk rooted one level wider
    // would pull every skill into the docs group — and CLAUDE.md is not under either.
    expect(groups.find((g) => g.key === 'docs')!.files.map((f) => f.path)).toEqual([`${DOCS_DIR}/d.md`]);
    expect(groups.find((g) => g.key === 'skills')!.files.map((f) => f.path)).toEqual([
      skillRel('one', 'SKILL.md'),
    ]);
  });
});

describe('control-files resources persistence', () => {
  it('keeps the good entries and drops the bad ones from a mixed list', async () => {
    const root = await tempDir();
    await mkdir(join(root, CONFIG_DIR), { recursive: true });
    await writeFile(
      join(root, RESOURCES_YAML),
      'links:\n  - title: Good\n    url: https://x.dev\n  - junk\n  - null\n  - title: "  "\n    url: "  "\n',
      'utf8',
    );
    // A survivor of the shape [entry, null] would come back with a hole in it.
    expect(await readResources(root)).toEqual([{ title: 'Good', url: 'https://x.dev' }]);
  });

  it('never writes a hole into the yaml for an entry it rejected', async () => {
    const root = await tempDir();
    await writeResources(root, [{ title: 'Keep', url: 'u' }, 'junk', null, 42, {}]);
    const yaml = await readFile(join(root, RESOURCES_YAML), 'utf8');
    expect(yaml).toBe('links:\n  - title: Keep\n    url: u\n');
  });

  it('writes an empty list rather than failing when handed no array at all', async () => {
    const root = await tempDir();
    await writeResources(root, undefined as unknown as unknown[]);
    expect(await readFile(join(root, RESOURCES_YAML), 'utf8')).toBe('links: []\n');
  });
});

// The five documents that bind every run. The OS denies them to every agent — the copilot included,
// since it runs under the same profile — so this editor is the only way they get written until
// pre-flight writes them through the server on approval.
describe('foundation documents in Project Control', () => {
  it('lists all five before any of them exists, so a missing one can be clicked and written', async () => {
    const root = await tempDir();
    const groups = await listControlFiles(root);
    const foundation = groups.find((g) => g.key === 'foundation');
    expect(foundation?.files.map((f) => f.name)).toEqual([
      'STACK.md',
      'CODE-QUALITY.md',
      'TESTING.md',
      'UX.md',
      'DESIGN.md',
    ]);
    // Managed: they are authority, so the copilot is soft-blocked and the user edits behind the
    // disclaimer. Fixed: deleting or renaming one re-opens the hole the gate reader exists to close.
    expect(foundation?.files.every((f) => f.managed && !f.deletable && !f.renameable)).toBe(true);
    expect(foundation?.creatable).toBe(false);
  });

  it('creates the file on save and reads it back', async () => {
    const root = await tempDir();
    const rel = `${FOUNDATION_DIR}/STACK.md`;
    // Empty for a file that is not there yet, rather than null — the editor opens on nothing and
    // saving is what creates it.
    expect((await readControlFile(root, rel))?.content).toBe('');
    expect(await writeControlFile(root, rel, '# Stack\n\nNode 22.\n')).toBe(true);
    expect((await readControlFile(root, rel))?.content).toBe('# Stack\n\nNode 22.\n');
  });

  it('refuses to delete or rename one, and refuses a path outside the five', async () => {
    const root = await tempDir();
    const rel = `${FOUNDATION_DIR}/STACK.md`;
    await writeControlFile(root, rel, 'x');
    expect(await deleteControlFile(root, rel)).toBe('not-allowed');
    expect(await renameControlFile(root, rel, 'Other')).toBeNull();
    // Not one of the five, and inside the folder: still refused, because the set is enumerated
    // rather than "anything under foundation/".
    expect(await writeControlFile(root, `${FOUNDATION_DIR}/NOTES.md`, 'x')).toBe(false);
    expect(await writeControlFile(root, `${FOUNDATION_DIR}/nested/STACK.md`, 'x')).toBe(false);
  });
});

// The links registry is a `resources` file by category, and that category is otherwise renameable
// and deletable — but renaming resources.yaml moves it to resources/<slug>.md and the registry is
// gone. No button offers it today; the flags must not say it is available.
describe('the links registry is not an ordinary resource', () => {
  it('is neither renameable nor deletable', async () => {
    const root = await tempDir();
    await writeControlFile(root, RESOURCES_YAML, 'links: []\n');
    const file = await readControlFile(root, RESOURCES_YAML);
    expect(file?.renameable).toBe(false);
    expect(file?.deletable).toBe(false);
    expect(await renameControlFile(root, RESOURCES_YAML, 'My links')).toBeNull();
    expect(await deleteControlFile(root, RESOURCES_YAML)).toBe('not-allowed');
    expect((await readControlFile(root, RESOURCES_YAML))?.content).toBe('links: []\n');
  });
});
