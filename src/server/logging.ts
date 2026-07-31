import type { FastifyServerOptions } from 'fastify';

// Fastify's own default is `logger: false`, and that silence was the whole problem: a route that
// threw answered 500 with nothing written anywhere, so a failure in the field left nothing to read
// afterwards. Logging is on here by default, and the level is the only knob.

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export const DEFAULT_LOG_LEVEL: LogLevel = 'info';

// pino throws on a level it doesn't know, which would turn a typo in an env var into a server that
// refuses to boot — the exact opposite of what turning logging on is for. Unknown values fall back.
export function resolveLevel(raw: string | undefined): LogLevel {
  const level = raw?.trim().toLowerCase() as LogLevel;
  return LOG_LEVELS.includes(level) ? level : DEFAULT_LOG_LEVEL;
}

export function loggerOptions(env: NodeJS.ProcessEnv = process.env): FastifyServerOptions['logger'] {
  return { level: resolveLevel(env.VIBEBOARD_LOG_LEVEL) };
}
