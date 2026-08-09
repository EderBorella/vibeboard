#!/bin/sh
# Start the API relay, then become the command.
#
# The relay has to be running before any agent does, and it cannot be started per command: `docker exec`
# does not run this entrypoint, and starting one per exec would race several listeners onto the same
# port. So it belongs to the container's life, not to any one command in it.
#
# `exec` on the last line so the real command is PID 1 — signals from `docker stop` reach it directly
# rather than being swallowed by a shell that would then have to forward them.
set -e

SOCKET="${VIBEBOARD_API_SOCKET:-/run/vibeboard/api.sock}"
if [ -d "$(dirname "$SOCKET")" ]; then
  node /opt/vibeboard/relay.mjs &
else
  # Said out loud rather than failing: a box with no API socket is still useful for running commands,
  # and silence here would turn into an agent reporting that the API is broken.
  echo "[vb-relay] $(dirname "$SOCKET") is not mounted — the VibeBoard API is not reachable from this box" >&2
fi

exec "$@"
