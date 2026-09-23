import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { type CliVersions, inspectVersions } from './cli-versions.js';
import type { BoxState } from './containers.js';
import {
  BOX_LABEL,
  type BoxBackend,
  type BoxPaths,
  boxMounts,
  boxName,
  createArgs,
  DEFAULT_IMAGE,
  type DockerResult,
  type DockerRun,
  dockerBin,
  execArgs,
  FIX_PACKAGES,
  globalIPv6,
  inspectState,
  installArgs,
  isPackageName,
  netRuleArgs,
  parsePublishedPort,
  protectedPaths,
  specDigest,
  workdirProbeArgs,
} from './containers.js';

const run = promisify(execFile);

// Talking to docker. One function, injectable, because everything above it is then testable without a
// daemon — and because the tests must not depend on a machine that happens to have docker.
//
// Exported because it is the ONLY one. `credential-freshness.ts` needs the same runner and briefly had
// its own copy; two of these means the `VIBEBOARD_DOCKER_BIN` override the suite depends on has two
// places to be wrong, and the error-shape mapping below has two places to drift.
export const spawnDocker: DockerRun = async (args, opts): Promise<DockerResult> => {
  try {
    const { stdout, stderr } = await run(dockerBin(), args, { timeout: opts?.timeoutMs ?? 30_000 });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string; message?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? String(err) };
  }
};

// The mounts for a project, with the protected paths filtered to the ones that actually exist. A bind
// mount whose source is missing is not ignored by docker — it CREATES it, root-owned, on the host, so a
// project with no `.git` would grow a root-owned `.git/hooks` the first time a box started.
export function boxPathsFor(
  projectRoot: string,
  extra: Omit<BoxPaths, 'projectRoot' | 'readOnly'>,
  exists: (path: string) => boolean = existsSync,
): BoxPaths {
  return { projectRoot, readOnly: protectedPaths(projectRoot, exists), ...extra };
}

// Why a box was thrown away and remade — the digest it had, and the one it needed.
type RebuildNotice = (name: string, was: string, now: string) => void;

interface BoxHandle {
  name: string;
  // Only for a box that publishes one — OpenCode's, whose server VibeBoard reaches over HTTP.
  hostPort?: number;
}

interface EnsureOptions {
  projectRoot: string;
  backend: BoxBackend;
  paths: BoxPaths;
  env?: Record<string, string>;
  publishPort?: number;
  command?: string[];
  image?: string;
  // The project's own packages, replayed into the box AT CREATION — the runtime half of the preset
  // ruling. In the spec digest (containers.ts specDigest), so a changed list replaces the box and is
  // replayed complete rather than diffed. decision 75.
  packages?: string[];
}

// One wording for both places that refuse, so an upgrade and a fresh build cannot explain the same fault
// two different ways.
function ipv6Refusal(address: string): string {
  return (
    `the agent box was given an IPv6 address (${address}) and VibeBoard's network rules are IPv4 only, ` +
    'so half its traffic would leave unconfined. Turn IPv6 off on the Docker bridge — see ' +
    'docs/security/containment.md.'
  );
}

// `built` is what the image records about the CLIs it was built with. Optional so a probe that never
// read it can say so; every reader takes its absence as nothing recorded.
export type ProbeResult =
  | { ok: true; built?: CliVersions }
  | { ok: false; reason: string; missing: 'daemon' | 'image' };

export class BoxManager {
  #docker: DockerRun;
  #user: string;

  // Told, not logged directly: rebuilding somebody's box is worth a line in the server log, and this
  // module has no logger and should not grow one.
  #onRebuild: RebuildNotice | undefined;

  constructor(opts: { docker?: DockerRun; user?: string; onRebuild?: RebuildNotice } = {}) {
    this.#docker = opts.docker ?? spawnDocker;
    this.#onRebuild = opts.onRebuild;
    // Resolved once. `process.getuid` is undefined on Windows, where none of this runs anyway.
    this.#user = opts.user ?? `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`;
  }

  // Is a box even possible here? Separate from `ensure` so the answer can be given before a dispatch is
  // attempted rather than as the failure of one — a box that cannot start surfaces as a non-zero exit
  // of the agent's own command, which is indistinguishable from the agent failing.
  // `missing` NAMES WHICH OF THE TWO, and it is not decoration. Both used to come back as one opaque
  // sentence, so anything downstream that wanted to act on "the image is not built" had to match on the
  // wording — and building against a daemon that is not running would spend a failed `docker build`
  // discovering what this call already knew. Two callers need the distinction now: the start script,
  // which builds, and the settings panel, which offers to.
  async probe(image = DEFAULT_IMAGE): Promise<ProbeResult> {
    const info = await this.#docker(['version', '-f', '{{.Server.Version}}']);
    if (info.code !== 0) {
      const reason = `Docker is not available — ${firstLine(info.stderr) || 'no daemon'}`;
      return { ok: false, reason, missing: 'daemon' };
    }
    // THE WHOLE RECORD, parsed in `inspectVersions`, and not a `-f` template. A template naming a key the
    // daemon's output lacks does not render empty, it exits 1 — and a non-zero exit here is read as "the
    // image is missing", which would offer a build for an image that is there. An unlabelled image has
    // no `Labels` key at all, so that is not hypothetical.
    const img = await this.#docker(['image', 'inspect', image]);
    if (img.code !== 0) {
      // The remedy is no longer a developer command. VibeBoard builds this itself on start, and offers
      // to from Settings — see `image-build.ts` for why printing `npm run box:build` at an installed
      // copy was an instruction nobody could follow.
      return {
        ok: false,
        reason: `the agent image ${image} is not built yet`,
        missing: 'image',
      };
    }
    return { ok: true, built: inspectVersions(img.stdout) };
  }

  // Create the box, or adopt the one already there.
  //
  // ADOPT RATHER THAN RECREATE. A container outlives VibeBoard by design, so after a restart there may
  // be a healthy box with an agent's session state in it. Killing it would throw away in-flight work
  // because the SERVER restarted, which is not the user's doing and not a good trade. A stopped box is
  // started rather than rebuilt for the same reason.
  async ensure(opts: EnsureOptions): Promise<BoxHandle> {
    const name = boxName(opts.projectRoot, opts.backend);
    const packages = opts.packages ?? [];
    // ONE image for the box and for the sidecar that confines it: the sidecar runs `iptables` inside
    // the box's own network namespace, and the base carries iptables precisely so that a box created
    // from the base — a `game` or `research` project — can be confined by an image it already has.
    const image = opts.image ?? DEFAULT_IMAGE;
    const spec = {
      image,
      mounts: boxMounts(opts.paths),
      env: opts.env ?? {},
      publish: opts.publishPort ? { containerPort: opts.publishPort } : undefined,
      command: opts.command,
      packages,
    };
    const wanted = specDigest(spec);
    const found = await inspectState(this.#docker, name);
    // BEFORE ADOPTION AS WELL AS AFTER CREATION, and the answer is already in hand — `inspectState` reads
    // it in the same call that reads the state and the spec. Corrected in review: the check lived only in
    // `#applyNetworkRules`, which runs on create and on start, so a box that was already RUNNING when this
    // version arrived would be adopted and used with a v6 address it had acquired under the previous one.
    // That is the upgrade case, and anyone who has turned v6 on is the only population it affects.
    if (found.state !== 'absent') await this.#refuseIPv6(name);
    let state = found.state;
    if (state !== 'absent' && (await this.#mustRebuild(name, found.spec, wanted, state))) {
      this.#onRebuild?.(name, found.spec, wanted);
      await this.#docker(['rm', '-f', name], { timeoutMs: 60_000 });
      state = 'absent';
    }

    if (state === 'absent') {
      const args = createArgs({
        name,
        projectRoot: opts.projectRoot,
        backend: opts.backend,
        user: this.#user,
        ...spec,
      });
      await this.#create(name, args, image, packages);
    } else if (state === 'stopped') {
      const started = await this.#docker(['start', name]);
      if (started.code !== 0) {
        throw new Error(`could not restart the agent box: ${firstLine(started.stderr)}`);
      }
      // Again on restart, NOT only on creation. A container's network namespace is rebuilt when it
      // starts, so rules installed into the old one are gone — a stopped-and-started box would come
      // back with the private network open and nothing would say so.
      await this.#applyNetworkRules(name, image);
    }

    return {
      name,
      hostPort: opts.publishPort ? await this.#publishedPort(name, opts.publishPort) : undefined,
    };
  }

  // BIRTH, and everything that has to be true before the box is handed to anyone: it started, its
  // network is confined, and it holds the packages the project declared. Its own method because each
  // step destroys the box rather than returning a box that is not what was asked for — a sequence that
  // reads as one thing here and as three nested failures inside `ensure`.
  async #create(name: string, args: string[], image: string, packages: string[]): Promise<void> {
    const created = await this.#docker(args, { timeoutMs: 120_000 });
    if (created.code !== 0) {
      throw new Error(`could not start the agent box: ${firstLine(created.stderr)}`);
    }
    await this.#applyNetworkRules(name, image);
    if (packages.length > 0) await this.#installOwn(name, packages);
  }

  // WHETHER THE BOX THAT IS THERE CAN BE ADOPTED. Two questions, and the second cannot be answered by
  // the first.
  //
  // BY NAME **AND SPEC**. A box's mounts, published ports and command are fixed when it is created, so
  // a box built for one purpose cannot serve another — and adopting one anyway is silent, which is the
  // worst property a containment decision can have. Two real failures came from adopting on the name
  // alone: an OpenCode server box adopted from a `sleep infinity` box that any earlier turn had
  // created, so it never published a port; and a box created before the project had a `.git`, which
  // therefore had no `.git/hooks` pin and never gained one.
  //
  // AND THE SPEC CANNOT SEE THE SECOND. The digest is over mount SOURCES, which are paths — and this
  // failure is a path that still reads the same while the directory behind it has been replaced. A box
  // adopted in that state answers every exec with an OCI error before the agent binary runs, which used
  // to be recorded as the card's failure. `workdirProbeArgs` carries the measurement.
  //
  // ONLY A RUNNING BOX IS PROBED, and that is the whole of the exposure rather than a saving: a bind
  // mount is resolved when a container STARTS, so a stopped box is about to be given a correct one by
  // `start`. It is the box that stayed up across the replacement that holds a deleted inode.
  async #mustRebuild(name: string, found: string, wanted: string, state: BoxState): Promise<boolean> {
    if (found !== wanted) return true;
    if (state !== 'running') return false;
    const reachable = await this.#docker(workdirProbeArgs(name), { timeoutMs: 30_000 });
    return reachable.code !== 0;
  }

  // FAILS THE BOX, deliberately. A box whose outbound rules did not apply is a box that can reach
  // every unauthenticated service on the machine and the rest of the LAN — which is precisely the
  // thing this is here to prevent. Carrying on with a warning would mean the protection is present
  // when it happens to work and absent, silently, when it does not.
  async #applyNetworkRules(name: string, image: string): Promise<void> {
    const res = await this.#docker(netRuleArgs(name, image), { timeoutMs: 60_000 });
    if (res.code !== 0) {
      await this.#docker(['rm', '-f', name], { timeoutMs: 60_000 });
      throw new Error(`could not confine the agent box's network: ${firstLine(res.stderr)}`);
    }
    // AND THE RULES JUST INSTALLED ARE IPv4 ONLY. `iptables` is what `netRuleArgs` writes; `ip6tables` is
    // never invoked. A box that also holds a v6 address is a box whose boundary covers only some of its
    // traffic, which is worse than no boundary because it looks confined.
    //
    // WRITING THE v6 RULES WAS CONSIDERED AND REJECTED, 2026-09-01. Docker ships bridge IPv6 off, so this
    // needs somebody to have turned it on deliberately — a v6-capable HOST whose bridge is v4-only gives
    // its containers no v6 address at all, which is the ordinary case and not a gap. Against that,
    // `ip6tables` is absent from some hosts and images, so adding the rules blindly would break boxes
    // that work today to cover a case nobody has. Detect and refuse needs no new dependency and fails
    // loudly. See docs/security/containment.md.
    await this.#refuseIPv6(name);
  }

  // DESTROY IT AND SAY SO, wherever the address turns up — after the rules are applied on create and on
  // start, and before a running box is adopted. A box whose boundary covers only some of its traffic is
  // worse than one with no boundary, because it looks confined. Its own method so both callers refuse
  // identically and neither handler carries the branch.
  async #refuseIPv6(name: string): Promise<void> {
    const ipv6 = await globalIPv6(this.#docker, name);
    if (ipv6 === '') return;
    await this.#docker(['rm', '-f', name], { timeoutMs: 60_000 });
    throw new Error(ipv6Refusal(ipv6));
  }

  // FAILS THE BOX, exactly as the network rules do and for the same reason: a box that exists without
  // its declared packages would be ADOPTED on every later ensure — replay is a birth event — and the
  // gap would be permanent and silent. Removing it makes the next ensure retry from scratch, and the
  // error names the package apt could not place. decision 75.
  async #installOwn(name: string, packages: string[]): Promise<void> {
    const res = await this.install(name, packages);
    if (res.code === 0) return;
    await this.#docker(['rm', '-f', name], { timeoutMs: 60_000 });
    // apt's own line, then where the name came from. The failure is almost always a package that does
    // not exist in this distribution, and the list it was read out of is the thing to edit.
    throw new Error(
      `could not install the project's own packages: ${firstLine(res.stderr || res.stdout)}${FIX_PACKAGES}`,
    );
  }

  // The privileged half, and the only place in VibeBoard that runs anything in a box as root.
  async install(name: string, packages: string[]): Promise<DockerResult> {
    const bad = packages.filter((p) => !isPackageName(p));
    if (bad.length > 0 || packages.length === 0) {
      return {
        code: 2,
        stdout: '',
        stderr: packages.length === 0 ? 'no packages given' : `not a package name: ${bad.join(', ')}`,
      };
    }
    // Long, because apt over a slow link is slow and a half-installed package is worse than a wait.
    return this.#docker(installArgs(name, packages), { timeoutMs: 600_000 });
  }

  async #publishedPort(name: string, containerPort: number): Promise<number | undefined> {
    const res = await this.#docker(['port', name, String(containerPort)]);
    return res.code === 0 ? parsePublishedPort(res.stdout) : undefined;
  }

  // Run something in the box. Returns argv rather than executing, so the existing spawn sites keep
  // their own process handling — their timeouts, their process-group kills, their stream plumbing.
  exec(
    name: string,
    bin: string,
    args: string[],
    env: Record<string, string> = {},
  ): { bin: string; args: string[] } {
    return { bin: dockerBin(), args: execArgs(name, bin, args, env) };
  }

  async stop(projectRoot: string, backend: BoxBackend): Promise<void> {
    await this.#docker(['rm', '-f', boxName(projectRoot, backend)], { timeoutMs: 60_000 });
  }

  // Every box this VibeBoard knows how to make, found by label rather than by anything we wrote down.
  // Used on shutdown and to reap boxes belonging to a project that is no longer open.
  async list(): Promise<string[]> {
    const res = await this.#docker([
      'ps',
      '-aq',
      '--filter',
      `label=${BOX_LABEL}=1`,
      '--format',
      '{{.Names}}',
    ]);
    if (res.code !== 0) return [];
    return res.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  }

  async stopAll(): Promise<number> {
    const names = await this.list();
    for (const name of names) await this.#docker(['rm', '-f', name], { timeoutMs: 60_000 });
    return names.length;
  }
}

// Docker's errors are multi-line and the first line is the one a person needs; the rest is a usage dump.
function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .find((l) => l.trim().length > 0)
      ?.trim() ?? ''
  );
}
