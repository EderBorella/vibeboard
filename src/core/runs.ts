// The run record, split into `runs/` by subject: the shape, reading a file, writing one, the
// transitions that produce a new record, and the questions asked about one.
//
// THIS FILE SURVIVES AS THE BARREL AND MUST. NodeNext has no directory-index resolution, so the
// twenty-odd modules that `import … from './runs.js'` cannot be pointed at `runs/index.js` —
// it is a `TS2307`, verified. Keeping the specifier is what made the split cost no importer a change.
//
// Re-export everything the split modules export. A symbol added there and missing here is invisible
// to every existing caller, which is the one failure mode this file has.

export {
  asVerification,
  parseAgentReport,
  parseRun,
} from './runs/parse.js';
export {
  isHandRun,
  isInFlight,
  isProjectRun,
  isRunId,
  needsResolution,
  producedNothing,
  RESOLVABLE_STATUSES,
  runId,
} from './runs/predicates.js';
export { RUN_RECORD_KEYS, serializeRun } from './runs/serialize.js';
export {
  withFilesChanged,
  withForgiveness,
  withoutReport,
  withReport,
  withResolution,
  withSuggestions,
  withUsage,
  withVerification,
} from './runs/transitions.js';
export {
  type AgentReport,
  REVIEW_VERDICTS,
  type ReviewVerdict,
  RUN_OUTCOMES,
  RUN_STATUSES,
  type RunOutcome,
  type RunRecord,
  type RunStatus,
  type RunUsage,
} from './runs/types.js';
