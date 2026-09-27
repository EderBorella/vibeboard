# Contributing

Bug reports and ideas are welcome as [issues](https://github.com/EderBorella/vibeboard/issues). For a
pull request bigger than a small fix, open an issue first, so we agree on the approach before you
spend time on it. Security bugs go through [`SECURITY.md`](SECURITY.md) instead.

## Licensing your contribution

VibeBoard is licensed under [PolyForm Noncommercial 1.0.0](LICENSE). By submitting a contribution,
you grant Eder Borella a perpetual, worldwide, royalty-free, irrevocable licence to use, copy,
modify, distribute, sublicense and relicense it, commercially or not, and you confirm that it is
yours to grant. You keep the copyright in your contribution.

## Working on the code

```bash
npm install       # also installs the pre-commit hook
npm test          # the unit suite
npm run check     # typechecks and source gates
npm run lint      # biome
```

The pre-commit hook runs formatting, the typechecks, lint and the tests against what you staged.
Do not skip it with `--no-verify`.

[`CLAUDE.md`](CLAUDE.md) is the project's working brief: the layer boundaries, the rules each one
keeps, and the gates that hold them. Read it before changing anything structural. A change that
touches agent boxes, credentials or the run lifecycle also needs the manual pass in
[`docs/smoke-test.md`](docs/smoke-test.md), because no unit test drives a real Docker daemon.

Commit messages say what changed and why, in plain sentences. `git log` shows the style.
