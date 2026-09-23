import { describe, expect, it } from 'vitest';
import { BoxManager } from '../src/server/boxes/box-manager.js';
import { BASE_IMAGE, DEFAULT_IMAGE, WORK_DIR } from '../src/server/boxes/containers.js';
import {
  agentRefusal,
  liveSandbox,
  NOT_REQUESTED,
  probeSandbox,
  wrapCommand,
} from '../src/server/boxes/sandbox.js';

// The gate, as a decision. What it decides ABOUT — that a container really does deny what it claims —
// is checked against a real one in box-integration.test.ts, which needs docker and skips without it.
// These need neither, and they are the tests that must never be skipped: they are the reason a run
// cannot start unconfined.

const OK = { ok: true as const, image: 'vibeboard-agent:test' };

describe('wrapCommand', () => {
  it('leaves the command untouched when there is no sandbox', () => {
    expect(wrapCommand('claude', ['-p'], NOT_REQUESTED)).toEqual({ bin: 'claude', args: ['-p'] });
  });

  it('routes the command into the box when there is one', () => {
    const { bin, args } = wrapCommand('claude', ['-p', 'hello'], OK, 'vibeboard-abc-claude-code');
    expect(bin).toContain('docker');
    // `-i` is not cosmetic: docker discards stdin without it, and the prompt travels on stdin because
    // it carries the run's credential and a command line is world-readable.
    expect(args).toEqual([
      'exec',
      '-i',
      '-w',
      WORK_DIR,
      'vibeboard-abc-claude-code',
      'claude',
      '-p',
      'hello',
    ]);
  });

  it('carries the environment the CLI needs on the far side of the boundary', () => {
    const { args } = wrapCommand('claude', [], OK, 'box', { CLAUDE_CONFIG_DIR: '/state/claude' });
    expect(args.join(' ')).toContain('-e CLAUDE_CONFIG_DIR=/state/claude');
  });

  it('THROWS rather than running unconfined when the sandbox is ok but no box was supplied', () => {
    // The failure this prevents is the quiet one. Returning the bare command here — which is what the
    // AppArmor version did for a missing sandbox — would spawn the agent on the host, unconfined,
    // while every caller and the whole UI went on reporting that agents are sandboxed.
    expect(() => wrapCommand('claude', ['-p'], OK)).toThrow(/refusing to run an agent unconfined/);
  });
});

describe('probeSandbox', () => {
  it('reports the image when a box is possible', async () => {
    const status = await probeSandbox({ probe: async () => ({ ok: true }) }, 'vibeboard-agent:test');
    expect(status).toEqual({ ok: true, image: 'vibeboard-agent:test' });
  });

  it('carries the reason through, because it names the thing that fixes it', async () => {
    const status = await probeSandbox(
      {
        probe: async () => ({ ok: false, reason: 'the agent image is not built — run `npm run box:build`' }),
      },
      'vibeboard-agent:test',
    );
    expect(status.ok).toBe(false);
    expect(status.ok === false && status.reason).toContain('box:build');
    expect(status.ok === false && status.kind).toBe('docker');
  });
});

// THERE ARE TWO IMAGES NOW, AND A MISSING BASE IS A BROKEN MACHINE. `imageForKind` sends a `game` or
// `research` project's box to `vibeboard-agent:base`, so a machine whose `:latest` predates the split has
// a green light and no box for those projects — the probe asked about one image and answered for both.
//
// THE REAL MANAGER, with only docker faked. The sentence under test is the manager's own per-image
// wording, so a stub that spelled it here would be a mock agreeing with itself about the one thing this
// is for. decision 75.
describe('both images are probed, because a box is built from either', () => {
  const holding = (images: readonly string[]): BoxManager =>
    new BoxManager({
      docker: async (args) => {
        if (args[0] === 'version') return { code: 0, stdout: '29.0.0\n', stderr: '' };
        if (args[0] === 'image') {
          const wanted = String(args.at(-1));
          return images.includes(wanted)
            ? { code: 0, stdout: 'sha256:abc\n', stderr: '' }
            : { code: 1, stdout: '', stderr: `Error: No such image: ${wanted}` };
        }
        return { code: 0, stdout: '', stderr: '' };
      },
    });

  it('is ok only when both of them are there', async () => {
    const status = await probeSandbox(holding([DEFAULT_IMAGE, BASE_IMAGE]), DEFAULT_IMAGE);
    expect(status).toEqual({ ok: true, image: DEFAULT_IMAGE });
  });

  it('refuses a machine that has the web layer and not the base, naming the base', async () => {
    const status = await probeSandbox(holding([DEFAULT_IMAGE]), DEFAULT_IMAGE);
    expect(status.ok).toBe(false);
    expect(status.ok === false && status.kind).toBe('docker');
    // Buildable, because the missing thing is an image and the build is the remedy — the same
    // discriminator the Settings button reads.
    expect(status.ok === false && status.buildable).toBe(true);
    expect(status.ok === false && status.reason).toContain(BASE_IMAGE);
  });

  it('names both when a machine has neither', async () => {
    const status = await probeSandbox(holding([]), DEFAULT_IMAGE);
    expect(status.ok === false && status.reason).toContain(BASE_IMAGE);
    expect(status.ok === false && status.reason).toContain(DEFAULT_IMAGE);
    expect(status.ok === false && status.buildable).toBe(true);
  });

  it('asks about the base only once it knows there is a daemon to ask', async () => {
    // A dead daemon answers both probes identically, and the second pair of docker calls would buy
    // nothing — while "the image is not built" is not what is wrong and not what should be shown.
    const asked: string[] = [];
    const status = await probeSandbox(
      {
        probe: async (img?: string) => {
          asked.push(img ?? DEFAULT_IMAGE);
          return {
            ok: false as const,
            reason: 'Docker is not available — no daemon',
            missing: 'daemon' as const,
          };
        },
      },
      DEFAULT_IMAGE,
    );
    expect(asked).toEqual([DEFAULT_IMAGE]);
    expect(status.ok === false && status.buildable).toBeUndefined();
  });
});

// AN IMAGE BEHIND ITS HOST IS STILL A WORKING SANDBOX, and says so beside the `ok`. It gates nothing:
// the three hundred runs that found it went through a box on 2.1.221 with the host on 2.1.280, and
// refusing agents for it would turn every host update — and every image built before the labels existed
// — into an outage until somebody spent minutes on a rebuild. What it does is put the rebuild in front of
// the person who can press it.
//
// THE REAL MANAGER, with only docker faked, and the inspect output in the shape a docker 29.6.0 daemon
// printed for the real images: an unlabelled image has no `Labels` key at all.
describe('an image whose CLIs are behind the host', () => {
  const HOST = { claude: '2.1.280', opencode: '1.17.18' };
  const labelled = (claude: string) => ({
    'io.vibeboard.cli.claude-code': claude,
    'io.vibeboard.cli.opencode': '1.17.18',
  });
  const holding = (labels: Record<string, Record<string, string> | undefined>, credentialDead = false) => {
    let hostReads = 0;
    const manager = new BoxManager({
      docker: async (args) => {
        if (args[0] === 'version') return { code: 0, stdout: '29.6.0\n', stderr: '' };
        if (args[0] === 'image') {
          const wanted = String(args.at(-1));
          if (!(wanted in labels))
            return {
              code: 1,
              stdout: '[]\n',
              stderr: `Error response from daemon: No such image: ${wanted}`,
            };
          const got = labels[wanted];
          return {
            code: 0,
            stdout: JSON.stringify([
              { Id: 'sha256:0f3c', Config: { WorkingDir: '/work', ...(got ? { Labels: got } : {}) } },
            ]),
            stderr: '',
          };
        }
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    const host = async () => {
      hostReads += 1;
      return HOST;
    };
    const credential = credentialDead
      ? async () => ({ fresh: false as const, reason: 'the sign-in has expired' })
      : undefined;
    return {
      probe: () => probeSandbox(manager, DEFAULT_IMAGE, credential, undefined, host),
      hostReads: () => hostReads,
    };
  };

  it('is ok and says nothing when both images hold the host’s versions', async () => {
    const h = holding({ [BASE_IMAGE]: labelled('2.1.280'), [DEFAULT_IMAGE]: labelled('2.1.280') });
    expect(await h.probe()).toEqual({ ok: true, image: DEFAULT_IMAGE });
  });

  it('is ok, and names the image and both versions, when the base is behind', async () => {
    const h = holding({ [BASE_IMAGE]: labelled('2.1.221'), [DEFAULT_IMAGE]: labelled('2.1.221') });
    const status = await h.probe();
    expect(status).toEqual({
      ok: true,
      image: DEFAULT_IMAGE,
      stale: `${BASE_IMAGE} has Claude Code 2.1.221 where this machine has 2.1.280`,
    });
  });

  // THE FAIL-SAFE READING, and the state every existing install is in.
  it('reads an image with no labels as one that cannot be shown to match', async () => {
    const h = holding({ [BASE_IMAGE]: undefined, [DEFAULT_IMAGE]: undefined });
    const status = await h.probe();
    expect(status.ok).toBe(true);
    expect(status.stale).toBe(
      `${BASE_IMAGE} was built before VibeBoard recorded CLI versions on its images, so it cannot be shown to match this machine's Claude Code 2.1.280 and OpenCode 1.17.18`,
    );
  });

  // NOT A SECOND REASON TO REFUSE, and not a replacement for the first one. A missing image is the fault
  // a build fixes, and it is the one said — without spending the host's two spawns to say it.
  it('leaves a missing image as the missing-image fault, and does not read the host for it', async () => {
    const h = holding({ [DEFAULT_IMAGE]: labelled('2.1.221') });
    const status = await h.probe();
    expect(status.ok === false && status.buildable).toBe(true);
    expect(status.stale).toBeUndefined();
    expect(h.hostReads()).toBe(0);
  });

  // Beside a refusal as well as beside an `ok`: the credential is what stops agents, and the rebuild is
  // still the answer to the image, so the panel can offer both.
  it('rides along with a refusal that has nothing to do with it', async () => {
    const h = holding({ [BASE_IMAGE]: labelled('2.1.221'), [DEFAULT_IMAGE]: labelled('2.1.221') }, true);
    const status = await h.probe();
    expect(status.ok === false && status.kind).toBe('credential');
    expect(status.stale).toContain('2.1.221');
  });

  it('is carried through the live status', async () => {
    const manager = new BoxManager({
      docker: async (args) =>
        args[0] === 'image'
          ? { code: 0, stdout: JSON.stringify([{ Config: { Labels: labelled('2.1.221') } }]), stderr: '' }
          : { code: 0, stdout: '29.6.0\n', stderr: '' },
    });
    const status = await liveSandbox(manager, DEFAULT_IMAGE, { now: () => 0, host: async () => HOST })();
    expect(status.stale).toContain('2.1.221');
  });
});

// A STALE CREDENTIAL IS A NOT-OK SANDBOX, and that is the whole mechanism. It could have been a fourth
// gate with its own call sites; folding it into the status means the dispatch gate, the auto-pilot
// gate, the copilot gate and the route all refuse it without any of them being told about it, and the
// light goes offline for free.
describe('a box holding a replaced credential', () => {
  const stale = {
    fresh: false as const,
    reason: 'the agent box is holding a sign-in that has been replaced',
  };
  const ok = { probe: async () => ({ ok: true as const }) };

  it('is reported as not ok, with the credential kind and the credential sentence', async () => {
    const status = await liveSandbox(ok, 'img', { now: () => 0, credential: async () => stale })();
    expect(status.ok).toBe(false);
    expect(status.ok === false && status.kind).toBe('credential');
    expect(status.ok === false && status.reason).toBe(stale.reason);
  });

  it('leaves the sandbox ok when the box is holding the current one', async () => {
    const status = await liveSandbox(ok, 'img', {
      now: () => 0,
      credential: async () => ({ fresh: true }),
    })();
    expect(status).toEqual({ ok: true, image: 'img' });
  });

  // The docker answer decides whether the second question is asked at all. An unbuilt image is the more
  // fundamental fault and "run `npm run box:build`" is the message that helps — telling someone with no
  // image to rebuild their boxes sends them to do a thing that cannot work.
  it('is not even asked about when docker has already said no', async () => {
    let asked = 0;
    const status = await liveSandbox(
      { probe: async () => ({ ok: false as const, reason: 'the agent image is not built' }) },
      'img',
      {
        now: () => 0,
        credential: async () => {
          asked += 1;
          return stale;
        },
      },
    )();
    expect(asked).toBe(0);
    expect(status.ok === false && status.kind).toBe('docker');
    expect(status.ok === false && status.reason).toBe('the agent image is not built');
  });

  // ONE cache, not two. A second TTL for the credential would let the two halves of one status disagree
  // for up to a second at a time, and the counts are the only thing that can tell that apart.
  //
  // The docker count is even because one probe asks about both images now — the web layer and the base.
  it('caches both answers under the one TTL, and a burst makes one probe of each', async () => {
    let clock = 0;
    let docker = 0;
    let credential = 0;
    const sandbox = liveSandbox(
      {
        probe: async () => {
          docker += 1;
          return { ok: true as const };
        },
      },
      'img',
      {
        ttlMs: 1000,
        now: () => clock,
        credential: async () => {
          credential += 1;
          return stale;
        },
      },
    );

    const burst = await Promise.all([sandbox(), sandbox(), sandbox(), sandbox()]);
    expect(burst.every((s) => !s.ok)).toBe(true);
    expect([docker, credential]).toEqual([2, 1]);

    clock += 999;
    await sandbox();
    expect([docker, credential]).toEqual([2, 1]);

    // And they expire together, because there is only one thing to expire.
    clock += 2;
    await sandbox();
    expect([docker, credential]).toEqual([4, 2]);
  });
});

describe('agentRefusal', () => {
  it('allows an agent when a box is available', () => {
    expect(agentRefusal(OK, undefined)).toBeNull();
  });

  it('refuses, naming the reason, when none is', () => {
    const reason = agentRefusal(
      { ok: false, reason: 'Docker is not available — no daemon', kind: 'docker' },
      undefined,
    );
    expect(reason).toContain('no daemon');
    expect(reason).toContain('container');
  });

  // The tail was written when a missing image was the only way to be not-ok, and it contradicts the
  // credential sentence outright: the container exists, is running, and is the thing holding the dead
  // sign-in. This reaches the user verbatim in the light's balloon, so the two halves have to agree —
  // otherwise it names a fix ("rebuild the boxes") and then denies the premise of it in the next clause.
  it('does not tell someone whose box is running that there is no container', () => {
    const reason = agentRefusal(
      {
        ok: false,
        reason: 'the box is holding a replaced sign-in — use "Rebuild the agent boxes"',
        kind: 'credential',
      },
      undefined,
    );
    expect(reason).toContain('Rebuild the agent boxes');
    expect(reason, 'the docker-only tail must not follow a credential reason').not.toContain(
      'there is none available here',
    );
  });

  it('refuses an attached OpenCode server even when a box is available', () => {
    // The server VibeBoard did not start is not in a box, so nothing restricts what it can reach —
    // and the status object cannot see that. Two functions once answered this question and diverged,
    // which is how a turn ran unwrapped while the gate said yes.
    const reason = agentRefusal(OK, 'http://127.0.0.1:9999');
    expect(reason).toContain('VIBEBOARD_OPENCODE_URL');
  });
});

// A BACKEND THAT IS NOT ANSWERING IS ALSO A NOT-OK SANDBOX, and it is the third fault this status carries.
//
// Docker being up and the credential being current says the machine COULD run an agent. It does not say the
// thing an agent talks to is alive. On 2026-08-16 an OpenCode server was destroyed under a live URL and every
// dispatch died in 449ms with `fetch failed` — three attempts spent in five seconds, and auto-pilot blamed
// the README. The lights were green throughout, because nothing was refusing and nothing had asked.
//
// ASYMMETRIC BY NECESSITY, and this is the decision worth stating: OpenCode is a long-lived server we can ask
// a question of for nothing, while Claude Code is a process spawned per turn, so there is no equivalent
// question that does not cost a real spawn. The checks therefore differ per backend — which means this status
// means slightly different things for the two, and that is better than a symmetric check that either costs
// money or proves nothing.
describe('a backend that is not answering', () => {
  const ok = { probe: async () => ({ ok: true as const }) };
  const dead = {
    live: false as const,
    reason: 'the OpenCode server in this project’s box is not answering — restart it in Settings › Sandbox',
  };

  it('is reported as not ok, with its own kind and its own sentence', async () => {
    const status = await liveSandbox(ok, 'img', { now: () => 0, backend: async () => dead })();

    expect(status.ok).toBe(false);
    expect(status.ok === false && status.kind).toBe('backend');
    expect(status.ok === false && status.reason).toBe(dead.reason);
  });

  it('leaves the sandbox ok when the backend answers', async () => {
    const status = await liveSandbox(ok, 'img', {
      now: () => 0,
      backend: async () => ({ live: true }),
    })();

    expect(status).toEqual({ ok: true, image: 'img' });
  });

  it('is asked AFTER the credential, so the more fundamental fault is the one reported', async () => {
    // A dead credential and an unanswering server can be true at once — an expired sign-in is why the
    // server would be refusing — and "fix your sign-in" is the message that helps. Asking anyway would also
    // cost a request per probe to a server that cannot work yet.
    let asked = 0;
    const status = await liveSandbox(ok, 'img', {
      now: () => 0,
      credential: async () => ({ fresh: false as const, reason: 'the sign-in has expired' }),
      backend: async () => {
        asked += 1;
        return dead;
      },
    })();

    expect(status.ok === false && status.kind).toBe('credential');
    expect(asked).toBe(0);
  });

  it('is not asked about when docker has already said no', async () => {
    let asked = 0;
    const status = await liveSandbox(
      { probe: async () => ({ ok: false as const, reason: 'the agent image is not built' }) },
      'img',
      {
        now: () => 0,
        backend: async () => {
          asked += 1;
          return dead;
        },
      },
    )();

    expect(status.ok === false && status.kind).toBe('docker');
    expect(asked).toBe(0);
  });
});
