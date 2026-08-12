import type { FastifyInstance } from 'fastify';
import { debugLogging, setDebugLogging } from '../app-state.js';
import { autopilotLogFileFor, logDir, logFileFor } from '../logging.js';

// The app's own settings, as opposed to a project's. Two things live here and they belong together: the
// debug switch, and WHERE the files it affects are.
//
// NO OPEN PROJECT IS REQUIRED, which is the reason this is not part of `PATCH /api/config`. These settings
// outlive whichever project happens to be open — the server starts with none — and the logs are VibeBoard's
// own folder rather than the user's content (see logging.ts). A debug switch written into a board project's
// config.yaml would be our state in their document, and would also be forgotten the moment they switched
// project, which is the least useful moment to lose it.
//
// Admin-only by absence from the scope table in auth.ts. Deliberate, and worth stating: an agent that could
// read this would learn the path of a file it is not otherwise told about, and one that could WRITE it could
// turn the record of what it did up or down.

export interface AppSettings {
  // Whether the auto-pilot loop's ordinary output is kept as well as its errors.
  debugLog: boolean;
  // The two files, as absolute paths, or null when this install writes none (VIBEBOARD_LOG_DIR is empty).
  // Reported rather than described, because "check the logs" is useless without the path — and the path is
  // derived from an install directory and today's date, so it is not something a person can guess.
  serverLog: string | null;
  autopilotLog: string | null;
}

function settings(debug: boolean, now: Date): AppSettings {
  const dir = logDir();
  return {
    debugLog: debug,
    serverLog: dir === undefined ? null : logFileFor(dir, now),
    autopilotLog: dir === undefined ? null : autopilotLogFileFor(dir, now),
  };
}

export async function registerSettingsRoutes(api: FastifyInstance): Promise<void> {
  api.get('/settings', async () => settings(await debugLogging(), new Date()));

  api.patch('/settings', async (req, reply) => {
    const body = req.body as { debugLog?: unknown };
    // A missing or non-boolean value is refused rather than coerced. `Boolean('false')` is `true`, and a
    // switch that silently turns itself on when a client sends the wrong shape is a switch nobody can trust.
    if (typeof body?.debugLog !== 'boolean') {
      return reply.code(400).send({ error: 'debugLog must be true or false.' });
    }
    try {
      await setDebugLogging(body.debugLog);
    } catch (err) {
      // Said out loud rather than swallowed: this file lives in the home directory, and a save that failed
      // silently would leave the switch showing a state the next start will not honour.
      return reply
        .code(500)
        .send({ error: `Could not save that setting: ${err instanceof Error ? err.message : String(err)}` });
    }
    return settings(body.debugLog, new Date());
  });
}
