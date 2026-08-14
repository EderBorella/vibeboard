// The dispatch prompt, split into `prompt/` by subject: the input contract and the assembly (index),
// the per-section builders (sections), what the run is asked to produce (contracts), and the one part
// that reaches the scope table (credential).
//
// THIS FILE SURVIVES AS THE BARREL AND MUST. NodeNext has no directory-index resolution, so the modules
// that `import … from './run-prompt.js'` cannot be pointed at `prompt/index.js` — it is a `TS2307`,
// verified. Keeping the specifier is what made the split cost no importer a change.
//
// Re-export everything the split modules export that anything outside `prompt/` asks for. A symbol added
// there and missing here is invisible to every existing caller, which is the one failure mode this file
// has.

export { assistCredentialSection } from './prompt/credential.js';
export { type BoardColumns, buildRunPrompt, type PromptInputs } from './prompt/index.js';
