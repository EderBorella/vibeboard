import { existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONFIG_DIR, RUNS_DIR } from '../src/core/layout.js';
import { BoxManager } from '../src/server/boxes/box-manager.js';
import { BoxService, boxPathsForBackend } from '../src/server/boxes/box-service.js';
import {
  boxMounts,
  type DockerResult,
  type DockerRun,
  INSTALL_HELPER,
  WORK_DIR,
} from '../src/server/boxes/containers.js';
import { boxCredentialPath, opencodeBoxCredentialPath } from '../src/server/boxes/copilot-env.js';
import { defaultConfig, writeConfig } from '../src/store/project/config.js';
import { tempDir, testTmp } from './helpers.js';

// What a box gets FOR a project and backend. The mount set is the containment boundary, and two of its
// properties cannot be seen by reading the argv:
//
//  1. a bind mount whose source does not exist is not skipped by docker — it is CREATED, root-owned, on
//     the host. So anything this returns must already be on disk.
//  2. the credential is the whole of the backend split. A Claude box gets the Claude credential and an
//     OpenCode box must not be able to read it — enforced by WHAT IS MOUNTED and not by a rule. Since
//     2026-09-01 each backend has a mirror of its own, so the enforcement is two sibling leaves with
//     nothing mounting the parent, rather than one backend simply having no credential mount at all.

// A HOST AND A COPILOT HOME OF THIS FILE'S OWN, for the whole file rather than per test.
//
// `boxPathsForBackend` mirrors the Claude credential as a side effect — deliberately, since it runs
// before every agent turn — so without this the suite would copy the developer's real token into their
// real cache. Set up and torn down once per RUN: a per-test directory here would leak one tree
// per test, which is how 440,653 of them once filled this filesystem's inode table.
const savedHome = process.env.HOME;
const savedCopilot = process.env.VIBEBOARD_COPILOT_HOME;
// The mirror resolves `XDG_CACHE_HOME` first, so on a machine that sets it — many do — a temp `HOME`
// alone would not contain this and the real token would be copied into the developer's real cache.
const savedCacheHome = process.env.XDG_CACHE_HOME;
let hostHome: string;

beforeAll(() => {
  hostHome = mkdtempSync(join(testTmp(), 'vibeboard-host-'));
  process.env.HOME = hostHome;
  delete process.env.XDG_CACHE_HOME;
  process.env.VIBEBOARD_COPILOT_HOME = mkdtempSync(join(testTmp(), 'vibeboard-copilot-'));
  mkdirSync(join(hostHome, '.claude'), { recursive: true });
  writeFileSync(join(hostHome, '.claude', '.credentials.json'), '{"token":"host"}', 'utf8');
  // AND OPENCODE'S, which is not decoration. Since 2026-09-01 an OpenCode box mounts a mirror of its
  // own, and a mirror is only made when the host has a credential to make it from — so without this
  // file the S2 assertion below would pass because the branch never ran, which is the shape of vacuity
  // this suite exists to refuse.
  mkdirSync(join(hostHome, '.local', 'share', 'opencode'), { recursive: true });
  writeFileSync(
    join(hostHome, '.local', 'share', 'opencode', 'auth.json'),
    '{"someprovider":{"type":"api","key":"placeholder-not-a-key"}}',
    'utf8',
  );
});

afterAll(() => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedCopilot === undefined) delete process.env.VIBEBOARD_COPILOT_HOME;
  else process.env.VIBEBOARD_COPILOT_HOME = savedCopilot;
  if (savedCacheHome === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = savedCacheHome;
});

describe('the paths a box is given', () => {
  it('CREATES the report directory, because docker would create it as root', async () => {
    // Not a tidiness point. Every project that has never run an agent lacks this directory — which is
    // exactly the set of projects about to run one — so without this the first dispatch would leave a
    // root-owned folder inside the user's own project, needing `sudo` to remove.
    const root = await tempDir();
    mkdirSync(join(root, CONFIG_DIR), { recursive: true });
    expect(existsSync(join(root, RUNS_DIR))).toBe(false);

    boxPathsForBackend(root, 'claude-code');

    expect(existsSync(join(root, RUNS_DIR))).toBe(true);
  });

  it('mounts that directory writable, inside a read-only .vibeboard', async () => {
    const root = await tempDir();
    mkdirSync(join(root, CONFIG_DIR), { recursive: true });

    const mounts = boxMounts(boxPathsForBackend(root, 'claude-code'));
    const reports = mounts.find((m) => m.target === `${WORK_DIR}/${RUNS_DIR}`);
    const config = mounts.find((m) => m.target === `${WORK_DIR}/${CONFIG_DIR}`);

    expect(reports).toBeDefined();
    expect(reports?.readOnly).toBeUndefined();
    expect(config?.readOnly).toBe(true);
  });

  it('gives a Claude box the Claude credential and an OpenCode box none of it', async () => {
    // Asserted through the real function rather than a hand-built path set, because the bug this guards
    // was in the wiring: both backends were handed the project's SHARED state root, and OpenCode's
    // `auth.json` lives inside it — so a Claude agent could read the user's other provider keys.
    const root = await tempDir();
    mkdirSync(join(root, CONFIG_DIR), { recursive: true });

    const claude = boxMounts(boxPathsForBackend(root, 'claude-code'));
    const opencode = boxMounts(boxPathsForBackend(root, 'opencode'));

    const creds = dirname(boxCredentialPath());
    const opencodeCreds = dirname(opencodeBoxCredentialPath());
    expect(opencode.some((m) => m.source.includes('.claude'))).toBe(false);
    // Nor the mirror, which is the credential's OTHER name now and would otherwise be a Claude
    // credential in an OpenCode box that the check above reads straight past.
    expect(opencode.some((m) => m.source === creds || m.source.startsWith(`${creds}/`))).toBe(false);
    expect(claude.some((m) => m.source === creds)).toBe(true);

    // AN OPENCODE BOX HAS A CREDENTIAL MOUNT OF ITS OWN as of 2026-09-01 — it used to have none, because
    // its credential was copied into the state directory instead, once, and so never refreshed again.
    // S2 is unchanged and is still held by what is mounted: two SIBLING leaves, and nothing mounts the
    // parent that holds both. Asserted as a sibling relationship rather than as two literals, so a
    // change that collapsed them into one directory fails here rather than in a box.
    expect(boxPathsForBackend(root, 'opencode').credential?.source).toBe(opencodeCreds);
    expect(opencode.some((m) => m.source === opencodeCreds)).toBe(true);
    expect(claude.some((m) => m.source === opencodeCreds)).toBe(false);
    expect(dirname(creds)).toBe(dirname(opencodeCreds));
    expect(creds).not.toBe(opencodeCreds);
    // And the parent itself is mounted by neither, which is what makes the two leaves meaningful.
    const parent = dirname(creds);
    expect([...claude, ...opencode].some((m) => m.source === parent)).toBe(false);
    // The two state directories are different directories, not one shared parent.
    const stateOf = (mounts: { source: string; target: string }[]) =>
      mounts.find((m) => m.target === '/state')?.source;
    expect(stateOf(claude)).not.toBe(stateOf(opencode));
    expect(stateOf(claude)).toMatch(/claude$/);
  });

  it('mounts the credential DIRECTORY, at one path meaning the same thing on both sides', async () => {
    // The bug, stated as an assertion. A bind-mounted FILE pins the inode it was created with; Claude
    // Code refreshes its token by writing a new file and renaming over the old, which makes a new one.
    // Measured on a live box: host inode 5280206, the same path inside the box inode 5303483 with a
    // link count of 0, and mountinfo naming the source `…/.credentials.json//deleted`. Every turn then
    // failed in 58ms as an expired session and auto-pilot blamed the card.
    //
    // Source and target are one path because the symlink VibeBoard writes into the config dir is
    // absolute: it has to resolve to the same file inside the box and out.
    const root = await tempDir();
    mkdirSync(join(root, CONFIG_DIR), { recursive: true });

    const credential = boxPathsForBackend(root, 'claude-code').credential;

    expect(credential?.source).toBe(dirname(boxCredentialPath()));
    expect(credential?.source).toBe(credential?.target);
    expect(statSync(credential?.source as string).isDirectory()).toBe(true);
    // And it is VibeBoard's own copy, never the user's `~/.claude` — which holds 894MB of session
    // transcripts and a `settings.json` whose hooks run on the HOST.
    expect(credential?.source.includes('.claude')).toBe(false);
    expect(credential?.source.startsWith(join(hostHome, '.claude'))).toBe(false);
  });
});

// ONE BOX PER (PROJECT, BACKEND) — including who asks for it.
//
// The OpenCode backend is a long-lived `opencode serve` that IS its box's main process, on a published
// port. Every other path — dispatching a run, a chat turn, a toolchain install — asked for a box with
// no port and `sleep infinity`. Adoption is by name AND spec, so those two callers evicted each other's
// box in turn, for ever: whichever ran last did `docker rm -f` and rebuilt.
//
// Measured on a live project on 2026-08-16: `opencode serve is up in its box` on 127.0.0.1:32775 at
// 22:55:15, the run dispatched at 22:55:40.473, and a container of the same name created 209ms later
// with `cmd ["sleep","infinity"]` and `ports {}`. VibeBoard was still holding the old URL, so all three
// attempts died in 449ms with `[opencode failed: fetch failed]` — no model reached, no tokens — and
// auto-pilot reported that the README was too thin to derive features from.
describe('a box is the same box whoever asks for it', () => {
  // Answers as a daemon that holds whatever was created, remembering the spec digest it was created
  // with. That memory is the whole point: a fake that reports no box can never show an eviction,
  // which is why the existing helper could not have caught this.
  const OK: DockerResult = { code: 0, stdout: '', stderr: '' };
  const SPEC = 'io.vibeboard.spec=';

  function daemon() {
    const removed: string[] = [];
    const created: string[][] = [];
    let present: string | undefined;

    const inspect = (): DockerResult =>
      present === undefined
        ? { code: 1, stdout: '', stderr: 'No such object' }
        : { code: 0, stdout: `true|${present}\n`, stderr: '' };

    const create = (args: string[]): DockerResult => {
      created.push(args);
      present = args.find((a) => a.startsWith(SPEC))?.slice(SPEC.length) ?? '';
      return OK;
    };

    const remove = (name: string): DockerResult => {
      removed.push(name);
      present = undefined;
      return OK;
    };

    const docker: DockerRun = async (args) => {
      if (args[0] === 'inspect') return inspect();
      if (args[0] === 'rm') return remove(String(args[2]));
      // `run -d --name <box>` is a create; `run --rm …` is the network sidecar, which is not.
      if (args[0] === 'run' && args[1] === '-d') return create(args);
      if (args[0] === 'port') return { code: 0, stdout: '127.0.0.1:32775\n', stderr: '' };
      return OK;
    };
    const boxes = new BoxService({
      manager: new BoxManager({ docker, user: '1000:1000' }),
      image: 'vibeboard-agent:test',
    });
    return { boxes, removed, created };
  }

  it('creates the OpenCode box AS the server, however plainly it was asked for', async () => {
    const root = await tempDir();
    mkdirSync(join(root, CONFIG_DIR), { recursive: true });
    const { boxes, created } = daemon();

    // The call agent-runner.ts makes before dispatching a run. It used to produce a box with no port
    // running `sleep infinity`, which is a box VibeBoard cannot talk to.
    await boxes.ensure(root, 'opencode');

    expect(created[0].slice(-6)).toEqual(['opencode', 'serve', '--port', '4096', '--hostname', '0.0.0.0']);
    // Published on the host's loopback only, and on a host port docker picks — a fixed one would
    // collide the moment two projects were open.
    expect(created[0]).toContain('127.0.0.1::4096');
  });

  it('does not evict the box a previous caller created', async () => {
    const root = await tempDir();
    mkdirSync(join(root, CONFIG_DIR), { recursive: true });
    const { boxes, removed, created } = daemon();

    // Two callers, one box. The server starts it; a run then asks for it; a toolchain install after
    // that. Any `docker rm -f` here is the container being destroyed under whoever was using it.
    await boxes.ensure(root, 'opencode');
    await boxes.ensure(root, 'opencode');
    await boxes.ensure(root, 'opencode');

    expect(removed).toEqual([]);
    expect(created).toHaveLength(1);
  });

  it('gives a run the published port the server is listening on', async () => {
    const root = await tempDir();
    mkdirSync(join(root, CONFIG_DIR), { recursive: true });
    const { boxes } = daemon();

    // Asked for plainly, the OpenCode box still has to be the serving one — a box with no port is a
    // box VibeBoard cannot reach, which is the failure this whole block is about.
    const box = await boxes.ensure(root, 'opencode');

    expect(box.hostPort).toBe(32775);
  });

  it("leaves the Claude box alone: no port, and it stays alive to be exec'd into", async () => {
    const root = await tempDir();
    mkdirSync(join(root, CONFIG_DIR), { recursive: true });
    const { boxes, created } = daemon();

    const box = await boxes.ensure(root, 'claude-code');

    expect(box.hostPort).toBeUndefined();
    expect(created[0].slice(-2)).toEqual(['sleep', 'infinity']);
    expect(created[0]).not.toContain('-p');
  });

  // The relay inside the box listens on VIBEBOARD_PORT and fell back to 4610 when the box was not told,
  // so a server on any other port had agents that could not reach it. Two ports, so a hard-coded 4610
  // cannot pass.
  it.each(['4610', '4620'])('tells the box the port the server is on (%s), for its relay', async (port) => {
    const saved = process.env.VIBEBOARD_PORT;
    process.env.VIBEBOARD_PORT = port;
    try {
      const root = await tempDir();
      mkdirSync(join(root, CONFIG_DIR), { recursive: true });
      const { boxes, created } = daemon();

      await boxes.ensure(root, 'claude-code');

      const env = created[0].flatMap((arg, i) => (created[0][i - 1] === '-e' ? [arg] : []));
      expect(env).toContain(`VIBEBOARD_PORT=${port}`);
    } finally {
      if (saved === undefined) delete process.env.VIBEBOARD_PORT;
      else process.env.VIBEBOARD_PORT = saved;
    }
  });
});

// WHICH IMAGE, AND WHOSE PACKAGES — read from the project's config HERE, by one reader, and never
// passed in by a caller. The block above is the whole reason: two callers describing the same box two
// different ways evicted each other's container, alternating, for ever. A kind passed as a parameter
// would be that bug a second time, so the only way in is the project's own config.
describe('the kind decides the image, resolved in one place', () => {
  // Answers as a daemon holding no box: every test here creates one, and what is asserted is the argv.
  const recording =
    (calls: string[][]): DockerRun =>
    async (args) => {
      calls.push(args);
      // The state read, and the only call whose failure means "no such box" — the v6 read below it
      // must answer empty rather than absent.
      if (args[0] === 'inspect' && args[1] === '-f') {
        return { code: 1, stdout: '', stderr: 'No such object' };
      }
      return { code: 0, stdout: '', stderr: '' };
    };

  const service = (calls: string[][], settings: Record<string, unknown>) =>
    new BoxService({
      manager: new BoxManager({ docker: recording(calls), user: '1000:1000' }),
      settings: async () => settings,
    });

  const project = async (): Promise<string> => {
    const root = await tempDir();
    mkdirSync(join(root, CONFIG_DIR), { recursive: true });
    return root;
  };

  const createArgv = (calls: string[][]): string[] | undefined =>
    calls.find((a) => a[0] === 'run' && a.includes('-d'));

  it('a research project gets the base image, and its packages travel to the manager', async () => {
    const calls: string[][] = [];
    await service(calls, { kind: 'research', packages: ['jq'] }).ensure(await project(), 'claude-code');
    expect(createArgv(calls)).toContain('vibeboard-agent:base');
    expect(calls.some((a) => a.includes(INSTALL_HELPER) && a.includes('jq'))).toBe(true);
  });

  it('no kind at all is the default image — an old project changes in nothing', async () => {
    const calls: string[][] = [];
    await service(calls, {}).ensure(await project(), 'claude-code');
    expect(createArgv(calls)).toContain('vibeboard-agent:latest');
  });

  it('refuses a mistyped kind by name rather than defaulting it', async () => {
    await expect(service([], { kind: 'webb' }).ensure(await project(), 'claude-code')).rejects.toThrow(
      /'webb' is not one of web, game, research/,
    );
  });

  // THE REFUSAL NAMES THE FILE AND THE KEY, because the author of this list is a person with a text
  // editor — `box.packages` is written by hand or by an admin PATCH, never by an agent. A message that
  // only says what is wrong leaves them looking for where, and the config is the only place to look.
  it('refuses a package list it could never install, and says which key to fix', async () => {
    await expect(
      service([], { packages: ['jq;rm -rf /'] }).ensure(await project(), 'claude-code'),
    ).rejects.toThrow(
      "not a package name in the project's own list: jq;rm -rf / — fix box.packages in .vibeboard/config.yaml",
    );
  });

  // DISTINCT FROM THE MANAGER'S, deliberately: that one answers an AGENT asking for an install through
  // the API, where there is no config file to fix and saying so would send it to a file it cannot read.
  it('does not hand the agent’s wording to the person editing the config', async () => {
    const res = await new BoxManager({ docker: recording([]), user: '1000:1000' }).install('box', [
      'jq;rm -rf /',
    ]);
    expect(res.stderr).toBe('not a package name: jq;rm -rf /');
    expect(res.stderr).not.toContain('config.yaml');
  });

  it('refuses a packages value that is not a list at all', async () => {
    await expect(service([], { packages: 'jq' }).ensure(await project(), 'claude-code')).rejects.toThrow(
      "the project's box.packages must be a list of names — fix box.packages in .vibeboard/config.yaml",
    );
  });

  // WHAT THE READER DOES WITH A CONFIG IT CANNOT USE, which used to be one bare `catch` answering
  // "no box settings" to every possible fault. Three different situations were one, and two of them
  // are silent: a project mid-scaffold, a config that will not parse, and a `box:` that is not a map.
  describe('the config reader', () => {
    // No `settings` injected, deliberately: the reader is the subject here, so it must be the real one.
    const boxes = (calls: string[][] = []) =>
      new BoxService({ manager: new BoxManager({ docker: recording(calls), user: '1000:1000' }) });

    it('reads a project with no config file at all as no box settings', async () => {
      // Mid-scaffold, or a root that is not a project yet. The only fault that is genuinely absence.
      const root = await project();
      const calls: string[][] = [];
      await boxes(calls).ensure(root, 'claude-code');
      expect(createArgv(calls)).toContain('vibeboard-agent:latest');
    });

    it('refuses a config it cannot read rather than pretending there were no settings', async () => {
      // The silent one: a hand edit that breaks the YAML gave the project the default image and an
      // empty package list, which is a box that is not the one the file asks for.
      const root = await project();
      writeFileSync(join(root, CONFIG_DIR, 'config.yaml'), 'box: {kind: web\npackages: [\n');
      await expect(boxes().ensure(root, 'claude-code')).rejects.toThrow(
        /the project's config could not be read: /,
      );
    });

    it('refuses a box block that is not a map, by name', async () => {
      const root = await project();
      writeFileSync(join(root, CONFIG_DIR, 'config.yaml'), 'name: p\nbox: web\n');
      await expect(boxes().ensure(root, 'claude-code')).rejects.toThrow(
        "the project's box block must be a map — fix .vibeboard/config.yaml",
      );
    });
  });

  // AND THE READER ITSELF, on a config file written by the real writer. Every test above injects
  // `settings`, so between them they prove only that the resolver agrees with a fake — the seam where
  // the config is actually read would be unexercised, which is how a mock comes to agree with itself.
  it('reads the kind off a real config file when nothing is injected', async () => {
    const root = await project();
    await writeConfig(root, { ...defaultConfig('p'), box: { kind: 'research', packages: ['jq'] } });
    const calls: string[][] = [];

    await new BoxService({
      manager: new BoxManager({ docker: recording(calls), user: '1000:1000' }),
    }).ensure(root, 'claude-code');

    expect(createArgv(calls)).toContain('vibeboard-agent:base');
    expect(calls.some((a) => a.includes(INSTALL_HELPER) && a.includes('jq'))).toBe(true);
  });
});
