#!/usr/bin/env node
// A stand-in for the `docker` CLI, for the suite only.
//
// WHY THIS EXISTS. The AppArmor wrapper was transparent — `aa-exec -p profile -- cmd` ran `cmd` on the
// host, so a test could put a shim on the far side of it and still exercise the real wrapping. Its
// replacement, `docker exec … box cmd`, is not: `cmd` lives inside a container that a unit test has no
// business creating. The alternatives were a bypass inside `wrapCommand` (a gate with a hole in it, for
// someone to reach for later) or tests that no longer cover the wrapping at all.
//
// So instead the DOCKER BINARY is the seam. This strips the exec prefix and runs the rest on the host,
// which means the argv VibeBoard built is still the argv under test — a wrong flag, a missing `-w`, a
// dropped `-e` all still show up. What it deliberately does NOT simulate is the isolation; that is
// what test/box-integration.test.ts checks, against a real container.
//
// Anything that is not `exec` answers the way a healthy daemon would, so `probe` and `ensure` succeed.

import { spawn } from 'node:child_process';

const argv = process.argv.slice(2);
const verb = argv[0];

// `logs -f` streams whatever the test put in this file, so the boxed server's output can be asserted
// the same way the child process's was.
if (verb === 'logs') {
  const file = process.env.VIBEBOARD_FAKE_DOCKER_LOGS;
  if (file) {
    const { createReadStream } = await import('node:fs');
    createReadStream(file).pipe(process.stdout, { end: false });
  }
  // Held open like the real `-f`, so the follower is not seen to exit. NOT a fall-through: without
  // this the exec parsing below would run on `logs` arguments and spawn something meaningless.
  setTimeout(() => process.exit(0), 5_000);
} else if (verb !== 'exec') {
  // `version`, `image inspect`, `inspect`, `run`, `start`, `rm`, `ps`, `port` — enough for the manager
  // to believe a box exists. `inspect -f {{.State.Running}}` is the one whose OUTPUT is read.
  // ABSENT, and NO published port. Both used to be answered unconditionally, which meant a box that
  // never asked to publish looked like one that had — masking the real defect where the OpenCode
  // server adopted a `sleep infinity` box and then found no port on it.
  if (verb === 'inspect') process.exit(1);
  if (verb === 'port') process.exit(1);
  if (verb === 'version') process.stdout.write('29.6.0\n');
  if (verb === 'image') process.stdout.write('sha256:fake\n');
  process.exit(0);
}

// exec [-u u:g] [-w dir] [-e K=V]... <container> <bin> [args...]
if (verb !== 'exec') {
  // Nothing further to do; the branches above either exited or are streaming.
} else {
let i = 1;
const env = { ...process.env };
let cwd;
// Whether `-i` was passed. THE DOUBLE HONOURS THIS, and it must: real `docker exec` discards stdin
// without it, and a double that forwarded stdin regardless would be kinder than the real thing — which
// is exactly how a missing `-i` shipped. Everything an agent is asked to do arrives on stdin, so the
// bug was total and the suite could not see it, because nothing here could fail without the flag.
let interactive = false;
while (i < argv.length) {
  const flag = argv[i];
  if (flag === '-e') {
    const [key, ...rest] = argv[i + 1].split('=');
    env[key] = rest.join('=');
    i += 2;
  } else if (flag === '-w') {
    // NOT applied: the container path (`/work`) does not exist on the host. Recorded so a test can
    // assert it was passed, which is the part that matters.
    env.VIBEBOARD_FAKE_DOCKER_WORKDIR = argv[i + 1];
    i += 2;
  } else if (flag === '-u') {
    env.VIBEBOARD_FAKE_DOCKER_USER = argv[i + 1];
    i += 2;
  } else if (flag === '-i') {
    interactive = true;
    i += 1;
  } else {
    break;
  }
}

env.VIBEBOARD_FAKE_DOCKER_BOX = argv[i];
const bin = argv[i + 1];
const rest = argv.slice(i + 2);

if (!bin) {
  process.stderr.write('fake-docker: no command after the container name\n');
  process.exit(2);
}

const child = spawn(bin, rest, {
  // stdin only when asked, exactly as docker behaves. stdout/stderr always, because `docker exec`
  // always returns those.
  stdio: [interactive ? 'inherit' : 'ignore', 'inherit', 'inherit'],
  env,
  cwd,
});
child.on('error', (err) => {
  process.stderr.write(`fake-docker: ${err.message}\n`);
  process.exit(127);
});
child.on('close', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
}
