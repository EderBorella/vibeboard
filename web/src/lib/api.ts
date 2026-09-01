// The browser's whole side of the HTTP API, split into `api/` by feature: the one network chokepoint
// (http), and then the project, the model catalogue, cards, Project Control, the explorer, skills, runs
// and the ledger, auto-pilot, the diary, what agents filed, the sandbox, signing in, and the app's own
// settings.
//
// THIS FILE SURVIVES AS THE BARREL AND MUST, and here for a sharper reason than on the server side.
// Fifty-nine modules import it, and twenty-six test files `vi.mock` it — nineteen of them under BOTH
// spellings, `'../web/src/lib/api.js'` and `'../web/src/api'`, because web code imports extensionless while
// the tests use the `.js` form. `web/` resolves with the bundler algorithm, so `./api` *would* find
// `api/index.ts`; relying on that would leave every one of those mocks pointed at a module nothing
// loads, and a mock that matches nothing fails silently by letting the real call through. Keeping a
// FILE at this specifier is what makes them keep working.
//
// Re-export everything the split modules export. A symbol added there and missing here is invisible to
// every existing caller — verified by omitting one and watching the mocking tests fail, which they do.
//
// Named re-exports rather than `export *` on purpose: `http.ts` has to expose `request`, `post`, `put`
// and `patch` to its siblings, and those were never part of this module's surface. A star would publish
// the bypass the chokepoint exists to prevent.

export {
  adoptCredential,
  approveSignin,
  claimSignin,
  collectSignin,
  getSigninState,
  probeCredential,
  refuseSignin,
  requestSignin,
  revokeDevice,
  type SigninCollected,
  type SigninDevice,
  type SigninPending,
  type SigninRequestOpened,
  type SigninState,
  setAuthority,
  signOutEverything,
} from './api/auth';
export {
  AUTOPILOT_STATES,
  type AutopilotState,
  type AutopilotStateName,
  acknowledgeGates,
  getAutopilotState,
  getReadiness,
  isSuccessReason,
  killAutopilot,
  type Readiness,
  restartAutopilot,
  STOP_REASONS,
  type StopReason,
  softStopAutopilot,
  startAutopilot,
} from './api/autopilot';
export {
  archiveCard,
  createCard,
  getRaw,
  listArchive,
  patchCard,
  placeCard,
  putRaw,
  restoreCard,
  setLinks,
} from './api/cards';
export {
  type ControlCategory,
  type ControlFile,
  type ControlGroup,
  createControlFile,
  deleteControlFile,
  getControlFile,
  getResources,
  listControlFiles,
  putControlFile,
  putResources,
  type ResourceLink,
  renameControlFile,
} from './api/control';
export {
  addDiaryEntry,
  DIARY_KINDS,
  type DiaryEntry,
  type DiaryKind,
  listDiary,
} from './api/diary';
export {
  createFsNode,
  type DirListing,
  deleteFsEntry,
  deleteFsTree,
  type FileRead,
  type FsNode,
  listDir,
  moveFsNode,
  putFsFile,
  readFsFile,
  renameFsNode,
} from './api/explorer';
export { ApiError, onUnauthorized } from './api/http';
export {
  getModelStatus,
  listModels,
  type ModelCaps,
  type ModelOption,
  type ModelStatus,
} from './api/models';
export {
  deleteProject,
  getState,
  listProjects,
  openProject,
  type ProjectRef,
  patchConfig,
  type ScaffoldMode,
  scaffoldProject,
} from './api/project';
export {
  type Accounting,
  type CardLedgerData,
  type CardRuns,
  cancelRun,
  type DispatchRequest,
  dispatchRun,
  forgiveCardAttempts,
  forgiveProjectAttempts,
  getAccounting,
  listCardRuns,
  listRuns,
  RUN_RECORD_KEYS,
  RUN_RECORD_NOT_MIRRORED,
  type RunList,
  type RunRecord,
  type RunStatus,
  type RunUsage,
  resolveRun,
  resolveRunRecord,
  type Spend,
  type Verification,
} from './api/runs';
export {
  getSandbox,
  rebuildBoxes,
  restartOpencodeServer,
  type SandboxState,
  takeOverOpencodeServer,
} from './api/sandbox';
export { type AppSettings, getAppSettings, setDebugLog } from './api/settings';
export {
  type InvalidSkill,
  listSkills,
  putSkill,
  type Skill,
  type SkillCatalogue,
} from './api/skills';
export { cardSuggestion, listSuggestions, patchSuggestion } from './api/suggestions';
