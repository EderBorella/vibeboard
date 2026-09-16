// WHAT THE AGENT BOX ALREADY HAS, so a run does not fetch it again.
//
// Found by reading a real run rather than taking its word: a report opened *"Playwright's browser was not
// present in this container, so I installed it into my own home cache"*. It WAS present. The agent
// downloaded a second copy anyway — 656MB, on top of the copy already in the image — because nothing in
// the prompt says what the box contains. The browser was only the first symptom; the gap is that an agent
// is told about the board, the cards, the columns and its own credential, and nothing at all about the
// machine it is standing in.
//
// THE VERSION IS PART OF THE FACT, and leaving it out would make the sentence a lie in the case that
// matters. Playwright keeps browsers in a per-release directory, so the Chromium here answers for the
// pinned version and no other: a project depending on a different Playwright will find nothing it can use
// and fetch its own, correctly. Telling an agent "a browser is installed" without that is how it comes to
// believe an install failed.
//
// MIRRORED FROM THE DOCKERFILE, and `test/image-tools.test.ts` reads that file and fails if these two
// values drift from it. A constant describing another file's contents is only safe while something
// compares them — this repository has the scar, and the mirror between `core/` and `web/src/lib/shared.ts`
// is held the same way.
export const BOX_BROWSERS_PATH = '/opt/ms-playwright';
export const BOX_PLAYWRIGHT_VERSION = '1.62.1';
