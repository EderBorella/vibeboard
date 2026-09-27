# Security

VibeBoard runs AI agents with your CLI logins and write access to your projects, so a security bug
here can cost someone more than a broken board. Please report one privately, not in a public issue.

## Reporting a vulnerability

Use GitHub's private reporting: the **Security** tab of this repository, then **Report a
vulnerability**. Only you and I can see the report. If that is not available to you, message me on
[LinkedIn](https://www.linkedin.com/in/eder-borella/) and I will arrange a private channel.

Say what you found, how to reproduce it, and what an attacker gains. A proof of concept helps, but
do not test against anyone's machine but your own.

## What counts

Anything that breaks the model in [`docs/security/model.md`](docs/security/model.md), for example:

- an agent reaching files outside its project, or writing to `.vibeboard/` or git's hooks and config;
- an agent reaching the host's local network or its other services;
- an agent's credential doing more than its scope allows, or outliving its run;
- a browser signing in, or driving an agent, without being allowed from one already signed in.

## Supported versions

VibeBoard is in beta. Fixes land on `main`; there are no maintained older releases.
