#!/usr/bin/env node
// Install, verify, or remove VibeBoard's agent sandbox.
//
//   npm run sandbox:install              check, and offer to install if it is missing
//   node scripts/install-sandbox.mjs --check      verify only, never escalate  (exit 1 if absent)
//   node scripts/install-sandbox.mjs --yes        install without the confirmation prompt
//   node scripts/install-sandbox.mjs --uninstall  remove it again
//
// It escalates ONLY through an explicit `sudo` you can see, after printing what it will run, and
// only when a human is at the terminal. Without a TTY — CI, a Docker build, a pre-commit hook — it
// prints the commands and exits non-zero instead. A build step that quietly loads kernel policy is
// indistinguishable from the supply-chain pattern this whole feature exists to defend against.
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROFILE_NAME = 'vibeboard-agent';
const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(here, '..', 'tools', 'apparmor', PROFILE_NAME);
const INSTALLED = `/etc/apparmor.d/${PROFILE_NAME}`;

const args = new Set(process.argv.slice(2));
const checkOnly = args.has('--check');
const assumeYes = args.has('--yes');
const uninstall = args.has('--uninstall');

const run = (cmd, argv) => spawnSync(cmd, argv, { stdio: 'inherit' });
const quiet = (cmd, argv) => spawnSync(cmd, argv, { encoding: 'utf8' });

// The kernel's answer, not the filesystem's. A profile that exists on disk and a profile that
// applies to a process are different facts, and only the second one is a control.
function enforcing() {
  const probe = quiet('aa-exec', ['-p', PROFILE_NAME, '--', 'cat', '/proc/self/attr/current']);
  return (probe.stdout ?? '').startsWith(`${PROFILE_NAME} (enforce)`);
}

// Installed but stale is its own state, and a silent one: the agent stays confined by whatever was
// loaded last, which may be missing a deny added since.
function drifted() {
  if (!existsSync(INSTALLED)) return false;
  try {
    return readFileSync(INSTALLED, 'utf8') !== readFileSync(SOURCE, 'utf8');
  } catch {
    return false; // unreadable without root — say nothing rather than guess
  }
}

function say(lines) {
  console.log(`\n${lines.map((l) => `  ${l}`).join('\n')}\n`);
}

if (!existsSync(SOURCE)) {
  console.error(`Cannot find the profile at ${SOURCE}`);
  process.exit(1);
}

if (process.platform !== 'linux') {
  say([
    `AppArmor is Linux-only, and this is ${process.platform}.`,
    '',
    'VibeBoard runs, and its agents do not: dispatching a run or a chat turn will refuse,',
    'because an agent that auto-approves its own tool calls has to be confined by the OS.',
  ]);
  process.exit(1);
}

if (quiet('apparmor_parser', ['--version']).status !== 0) {
  say([
    'AppArmor is not available on this machine (no apparmor_parser).',
    '',
    'Debian/Ubuntu:  sudo apt install apparmor apparmor-utils',
    'openSUSE:       sudo zypper install apparmor-parser apparmor-utils',
    '',
    'Fedora and Arch use SELinux or nothing, and VibeBoard cannot confine agents there yet.',
  ]);
  process.exit(1);
}

if (uninstall) {
  say([`Removing ${PROFILE_NAME}. This will run:`, '', `  sudo apparmor_parser -R ${INSTALLED}`, `  sudo rm -f ${INSTALLED}`]);
  run('sudo', ['apparmor_parser', '-R', INSTALLED]);
  run('sudo', ['rm', '-f', INSTALLED]);
  say([enforcing() ? 'Still loaded — something else installed it too.' : 'Removed. Agents will now refuse to run.']);
  process.exit(0);
}

if (enforcing() && !drifted()) {
  say([
    `✓ ${PROFILE_NAME} is loaded and enforcing.`,
    '',
    'Agents can build your project. They cannot write the files that govern it: cards and run',
    'records, config.yaml, skills, the instructions injected into every turn, the project log,',
    "or VibeBoard's own credential.",
    '',
    existsSync(INSTALLED)
      ? `Installed at ${INSTALLED}, so it survives a reboot.`
      : `NOT in /etc/apparmor.d — loaded for this boot only. Re-run without --check to install it properly.`,
  ]);
  process.exit(existsSync(INSTALLED) ? 0 : 1);
}

const why = drifted()
  ? `The loaded profile is OLDER than ${SOURCE}. Re-install to pick up the changes.`
  : 'VibeBoard confines every agent it runs with an AppArmor profile. It is not installed yet.';

say([
  why,
  '',
  'Installing copies the profile into the system policy directory and loads it. Two commands:',
  '',
  `  sudo install -m 644 ${SOURCE} ${INSTALLED}`,
  `  sudo apparmor_parser -r -W ${INSTALLED}`,
  '',
  'Once per machine, not per project — the rules are globs, so every project you open is covered.',
  `Read it first if you like: ${SOURCE}`,
]);

if (checkOnly) process.exit(1);

if (!process.stdin.isTTY || process.env.CI) {
  say(['No terminal to ask at (CI, or a non-interactive shell). Run the two commands above by hand.']);
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = (await rl.question('  Run them now with sudo? [y/N] ')).trim().toLowerCase();
rl.close();
if (answer !== 'y' && answer !== 'yes') {
  say(['Nothing was changed.']);
  process.exit(1);
}

if (run('sudo', ['install', '-m', '644', SOURCE, INSTALLED]).status !== 0) {
  say(['Copying the profile failed. Nothing was loaded.']);
  process.exit(1);
}
if (run('sudo', ['apparmor_parser', '-r', '-W', INSTALLED]).status !== 0) {
  say(['Loading the profile failed. It is on disk but not in force.']);
  process.exit(1);
}

// Verified by transitioning into it, not by trusting the exit code above.
if (!enforcing()) {
  say([
    'The commands succeeded but the profile is not enforcing.',
    '',
    'Check `sudo aa-status | grep vibeboard`, and whether AppArmor is enabled at boot',
    '(`cat /sys/kernel/security/lsm` should list `apparmor`).',
  ]);
  process.exit(1);
}

say([
  `✓ ${PROFILE_NAME} installed at ${INSTALLED} and enforcing.`,
  '',
  'It survives a reboot. Re-run this after pulling a change to the profile.',
]);
