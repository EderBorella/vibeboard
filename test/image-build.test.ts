import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BoxManager } from '../src/server/boxes/box-manager.js';
import type { CliVersions } from '../src/server/boxes/cli-versions.js';
import { BASE_IMAGE, DEFAULT_IMAGE } from '../src/server/boxes/containers.js';
import { agentBuildContext, buildArgs, ensureAgentImages } from '../src/server/boxes/image-build.js';
import { probeSandbox } from '../src/server/boxes/sandbox.js';

// BUILDING THE AGENT IMAGE FROM INSIDE THE PRODUCT.
//
// The product detected the missing prerequisite, named it, and had no code path that could satisfy it:
// it printed `npm run box:build`, which is a developer command. An installed VibeBoard has no npm
// scripts, no Dockerfile and no repository — so the single instruction it gave for its own hard
// dependency only worked inside a git clone, and on any other machine the app was bricked.

const HOST: CliVersions = { claude: '2.1.280', opencode: '1.17.18' };
const OLD: CliVersions = { claude: '2.1.221', opencode: '1.17.18' };

describe('the build context', () => {
  // THE CLAIM THAT MAKES IT SHIPPABLE. The base copies three files, all of them from this directory,
  // so the context was never the repository root — that was just what the npm script passed. Narrowing
  // it is what lets the build run from an installed tree. BOTH Dockerfiles, since the split: the build
  // points `-f` at each in turn out of this same context, so a base missing from an installed tree is a
  // build that fails on the image every other one is FROM. decision 75.
  it('is a real directory holding everything the Dockerfile copies', () => {
    const context = agentBuildContext();
    for (const file of ['Dockerfile.base', 'Dockerfile.agent', 'relay.mjs', 'entrypoint.sh', 'vb-install']) {
      expect(existsSync(join(context, file))).toBe(true);
    }
  });

  // Resolved from the module and not from `process.cwd()`, so `npm start` from any directory finds the
  // install it is running — the same claim `logging.ts` makes about its own root, and the same failure
  // if it is wrong: it works in development and nowhere else.
  it('does not depend on the working directory', () => {
    const here = agentBuildContext();
    const previous = process.cwd();
    try {
      process.chdir('/');
      expect(agentBuildContext()).toBe(here);
    } finally {
      process.chdir(previous);
    }
  });

  it('names the Dockerfile as well as the context, because it is not called Dockerfile', () => {
    const args = buildArgs('vibeboard-agent:test');
    expect(args[0]).toBe('build');
    expect(args).toContain('-f');
    expect(args.some((a) => a.endsWith('Dockerfile.agent'))).toBe(true);
    expect(args).toContain('vibeboard-agent:test');
    // The context is the LAST argument, and it is the directory rather than the file.
    expect(args.at(-1)).toBe(agentBuildContext());
  });

  // THE PIN FOLLOWS THE HOST. The whole fix is these four flags: the versions go in as the build args
  // Dockerfile.base installs from, and come out as labels the probe can read without a container.
  it('carries the host CLI versions as build args and as labels, before the context', () => {
    expect(buildArgs(BASE_IMAGE, '/ctx', 'Dockerfile.base', HOST)).toEqual([
      'build',
      '-f',
      '/ctx/Dockerfile.base',
      '-t',
      BASE_IMAGE,
      '--build-arg',
      'CLAUDE_VERSION=2.1.280',
      '--label',
      'io.vibeboard.cli.claude-code=2.1.280',
      '--build-arg',
      'OPENCODE_VERSION=1.17.18',
      '--label',
      'io.vibeboard.cli.opencode=1.17.18',
      '/ctx',
    ]);
  });
});

type Answer = { ok: true; built?: CliVersions } | { ok: false; reason: string; missing: 'daemon' | 'image' };
const probing = (answer: Answer) => ({ probe: async () => answer });
const hostOf = (versions: CliVersions) => {
  let reads = 0;
  return {
    host: async () => {
      reads += 1;
      return versions;
    },
    reads: () => reads,
  };
};
// The build itself is docker; these are about the decision, so the builder only records what it was asked.
const recording = () => {
  const built: { image: string; versions: CliVersions }[] = [];
  return {
    built,
    build: async (
      _onLine: (line: string) => void,
      image?: string,
      _file?: string,
      versions?: CliVersions,
    ) => {
      built.push({ image: image ?? '', versions: versions ?? {} });
      return { ok: true, last: '' };
    },
  };
};

describe('building only when the image is what is missing', () => {
  it('does nothing at all when the image is already there and matches the host', async () => {
    const lines: string[] = [];
    const b = recording();
    const result = await ensureAgentImages(probing({ ok: true, built: HOST }), (l) => lines.push(l), {
      host: hostOf(HOST).host,
      whenStale: 'rebuild',
      build: b.build,
    });
    expect(result).toBe('present');
    expect(lines).toEqual([]); // an ordinary start says nothing and costs one inspect per image
    expect(b.built).toEqual([]);
  });

  // A MISSING DAEMON IS NOT A MISSING IMAGE, and `probe` names which precisely so this can tell them
  // apart. Building against a daemon that is not running spends a failed multi-minute build to discover
  // what the probe already said — and reading the host's CLIs would spend two spawns on the same news.
  it('does not try to build, or read the host, when docker itself is not there', async () => {
    const lines: string[] = [];
    const h = hostOf(HOST);
    const result = await ensureAgentImages(
      probing({ ok: false, reason: 'Docker is not available — no daemon', missing: 'daemon' }),
      (l) => lines.push(l),
      { host: h.host, whenStale: 'rebuild' },
    );
    expect(result).toBe('no-docker');
    expect(lines).toEqual([]);
    expect(h.reads()).toBe(0);
  });
});

describe('building both images', () => {
  it('buildArgs can point at the base Dockerfile', () => {
    const args = buildArgs(BASE_IMAGE, '/ctx', 'Dockerfile.base');
    expect(args).toEqual(['build', '-f', '/ctx/Dockerfile.base', '-t', BASE_IMAGE, '/ctx']);
  });

  it('ensures the base before the web layer, because FROM names it', async () => {
    const probed: string[] = [];
    // Base missing, web present: only the base may be built, and it must be asked about first.
    const service = {
      probe: async (image?: string) => {
        probed.push(image ?? '');
        return image === BASE_IMAGE
          ? ({ ok: false, reason: 'absent', missing: 'image' } as const)
          : ({ ok: true, built: HOST } as const);
      },
    };
    const b = recording();
    const lines: string[] = [];
    const result = await ensureAgentImages(service, (l) => lines.push(l), {
      host: hostOf(HOST).host,
      whenStale: 'report',
      build: b.build,
    });
    expect(probed[0]).toBe(BASE_IMAGE);
    expect(b.built).toEqual([{ image: BASE_IMAGE, versions: HOST }]);
    expect(result).toBe('built');
    // And it says what it pinned to, so a build log shows which CLIs the box is about to hold.
    expect(lines).toContain(
      "Pinning the agent CLIs to this machine's: Claude Code 2.1.280, OpenCode 1.17.18.",
    );
  });
});

// A STALE IMAGE IS REBUILT BY THE BUTTON, and only reported by the start. The route used to answer
// `present` for any image that existed, so an image on 2.1.221 under a 2.1.280 host could not be rebuilt
// from the product at all.
describe('an image whose CLIs have drifted from the host', () => {
  const stale = (versions: CliVersions = OLD) => probing({ ok: true, built: versions });

  it('is rebuilt when the caller asks for that, base first, both pinned to the host', async () => {
    const b = recording();
    const lines: string[] = [];
    const result = await ensureAgentImages(stale(), (l) => lines.push(l), {
      host: hostOf(HOST).host,
      whenStale: 'rebuild',
      build: b.build,
    });
    expect(result).toBe('built');
    // The web layer still carries the OLD base's labels after the base is rebuilt — it inherited them —
    // so it is rebuilt too, onto the new base, and labelled with what that base now holds.
    expect(b.built).toEqual([
      { image: BASE_IMAGE, versions: HOST },
      { image: DEFAULT_IMAGE, versions: HOST },
    ]);
    expect(lines).toContain(
      `Rebuilding ${BASE_IMAGE}, which has Claude Code 2.1.221 where this machine has 2.1.280. This takes a few minutes.`,
    );
  });

  // THE START DOES NOT REBUILD IT. A start is minutes of `npm install` after every host update — and under
  // `npm run dev` the next save kills the build half way — while the image it would replace still works.
  it('is reported, once, and left alone, when the caller asks only to be told', async () => {
    const b = recording();
    const lines: string[] = [];
    const result = await ensureAgentImages(stale(), (l) => lines.push(l), {
      host: hostOf(HOST).host,
      whenStale: 'report',
      build: b.build,
    });
    expect(result).toBe('present');
    expect(b.built).toEqual([]);
    // ONE line, naming the base: the web layer stands on it and holds the same CLIs, so a second line
    // would be the same news.
    expect(lines).toEqual([
      `${BASE_IMAGE} has Claude Code 2.1.221 where this machine has 2.1.280. Rebuild it from Settings › Agent sandbox.`,
    ]);
  });

  it('names the web layer when it is the one behind', async () => {
    const lines: string[] = [];
    const service = {
      probe: async (image?: string) => ({ ok: true as const, built: image === BASE_IMAGE ? HOST : OLD }),
    };
    await ensureAgentImages(service, (l) => lines.push(l), {
      host: hostOf(HOST).host,
      whenStale: 'report',
      build: recording().build,
    });
    expect(lines).toEqual([
      `${DEFAULT_IMAGE} has Claude Code 2.1.221 where this machine has 2.1.280. Rebuild it from Settings › Agent sandbox.`,
    ]);
  });

  // THE UNLABELLED IMAGE — every image built before this change — is offered the rebuild, because nothing
  // on it says it matches. The same image on a machine with no CLI of its own is left alone: there is no
  // host state for it to skew against, and a rebuild could never clear the question.
  it('treats an unlabelled image as drifted where the host has a version, and as current where not', async () => {
    const b = recording();
    const lines: string[] = [];
    expect(
      await ensureAgentImages(stale({}), (l) => lines.push(l), {
        host: hostOf({}).host,
        whenStale: 'rebuild',
        build: b.build,
      }),
    ).toBe('present');
    expect([lines, b.built]).toEqual([[], []]);

    expect(
      await ensureAgentImages(stale({}), (l) => lines.push(l), {
        host: hostOf(HOST).host,
        whenStale: 'rebuild',
        build: b.build,
      }),
    ).toBe('built');
    expect(lines[0]).toBe(
      `Rebuilding ${BASE_IMAGE}, which was built before VibeBoard recorded CLI versions on its images, so it cannot be shown to match this machine's Claude Code 2.1.280 and OpenCode 1.17.18. This takes a few minutes.`,
    );
  });

  // EACH IMAGE IS LABELLED WITH WHAT IT HOLDS, not with what the host has. A web layer built at start on
  // top of a base that is behind holds the base's CLIs — labelling it with the host's would make it read
  // as current, and the button would then rebuild the base and leave this layer on the old one for good.
  it('labels a web layer built on a stale base with the base’s versions, not the host’s', async () => {
    const b = recording();
    const service = {
      probe: async (image?: string) =>
        image === BASE_IMAGE
          ? ({ ok: true, built: OLD } as const)
          : ({ ok: false, reason: 'absent', missing: 'image' } as const),
    };
    await ensureAgentImages(service, () => {}, {
      host: hostOf(HOST).host,
      whenStale: 'report',
      build: b.build,
    });
    expect(b.built).toEqual([{ image: DEFAULT_IMAGE, versions: OLD }]);
  });

  it('reads the host once per call, however many images it asks about', async () => {
    const h = hostOf(HOST);
    await ensureAgentImages(stale(), () => {}, {
      host: h.host,
      whenStale: 'rebuild',
      build: recording().build,
    });
    expect(h.reads()).toBe(1);
  });
});

// THE LABEL THE BUILD WRITES IS THE LABEL THE PROBE READS. Two halves built to one contract, and the only
// test with neither half faked: the argv comes from the real `buildArgs`, the inspect JSON is what docker
// makes of those `--label`s, and the real `BoxManager.probe` and `probeSandbox` read it back. Every other
// test spells the label out on one side, so a change to how the writer spells it, carried into those
// tests, leaves them all green and the reader behind — this is the test that still fails.
describe('what the build records, the probe reads', () => {
  const dockerHolding = (argv: string[]) => {
    const labels: Record<string, string> = {};
    argv.forEach((arg, i) => {
      if (arg !== '--label') return;
      const [key, ...value] = argv[i + 1].split('=');
      labels[key] = value.join('=');
    });
    return new BoxManager({
      docker: async (args) => {
        if (args[0] === 'version') return { code: 0, stdout: '29.6.0\n', stderr: '' };
        if (args[0] === 'image') {
          return {
            code: 0,
            stdout: JSON.stringify([{ Id: 'sha256:0f3c', Config: { Labels: labels } }]),
            stderr: '',
          };
        }
        return { code: 0, stdout: '', stderr: '' };
      },
    });
  };

  it('reads an image built for this host as current', async () => {
    const manager = dockerHolding(buildArgs(BASE_IMAGE, '/ctx', 'Dockerfile.base', HOST));
    expect(await probeSandbox(manager, DEFAULT_IMAGE, undefined, undefined, async () => HOST)).toEqual({
      ok: true,
      image: DEFAULT_IMAGE,
    });
  });

  it('reads the same image as behind once the host moves', async () => {
    const manager = dockerHolding(buildArgs(BASE_IMAGE, '/ctx', 'Dockerfile.base', OLD));
    const status = await probeSandbox(manager, DEFAULT_IMAGE, undefined, undefined, async () => HOST);
    expect(status).toEqual({
      ok: true,
      image: DEFAULT_IMAGE,
      stale: `${BASE_IMAGE} has Claude Code 2.1.221 where this machine has 2.1.280`,
    });
  });
});
