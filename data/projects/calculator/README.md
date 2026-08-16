# calculator

A working replica of the **Windows 98 Calculator**, running as a web app in a browser tab.

It does what that calculator did, and it looks like it did: a grey `#C0C0C0` window with a title bar,
a menu bar, a sunken white display, and a grid of beveled buttons. One player, one page, no network
calls after the page loads.

## What it is

The **Standard** view of the Windows 98 calculator, reproduced faithfully:

- A **display** showing the current entry or result, right-aligned, starting at `0.`
- A **memory indicator** box that shows `M` when the memory register holds a value
- **Digits** `0`–`9` and a decimal point
- **Four operations** — `+`, `-`, `*`, `/` — and `=`
- `+/-` (sign toggle), `sqrt`, `%`, `1/x`
- `Backspace`, `CE` (clear entry) and `C` (clear all)
- **Memory keys** `MC`, `MR`, `MS`, `M+`
- **Keyboard** support matching the original's shortcuts
- The **window chrome**: title bar with the calculator icon and its minimise/maximise/close buttons,
  and an `Edit / View / Help` menu bar that opens

## How it is served

A single static page served over HTTP by a small server written against the **Node standard library**
— no framework, no bundler, no build step, and no runtime dependencies. The browser gets plain HTML,
CSS and ES modules. Open the URL, and the calculator is there.

## How it is tested

**Playwright drives a real browser** against the served app, and that is the test that counts. It
checks both halves of the job:

- **The app works** — click and keyboard sequences produce the right display, chained operations
  behave like the original, division by zero shows the error, memory keys hold and recall.
- **The UI is correct** — the button grid is laid out in the right rows and columns, the window is
  the right shape, the display is sunken and right-aligned, the beveled borders and the grey face are
  the colours they should be, and nothing overflows or wraps at the window's fixed size.

The calculation engine is separately unit-tested as pure functions, because arithmetic edge cases are
cheaper to pin there than through a browser.

## Scope

**This README is the ceiling.** The Standard view is the whole product. Not in scope, and not to be
derived as work: the Scientific view, unit conversion, history or a tape, themes, persistence between
sessions, accounts, telemetry, packaging as a desktop app, mobile-specific layouts, and any backend
beyond serving three static files.
