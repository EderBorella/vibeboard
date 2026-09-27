import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { BoxService } from './box-service.js';

const run = promisify(execFile);

// HOW MUCH A BOX'S NETWORK HAS MOVED, from its own /proc/net/dev. It changes while the agent talks to its model
// or fetches anything, on either backend — the OpenCode one reports no event until its turn is over — which is
// what "still working" means for a Mini run (decision 101). Undefined when it cannot be read.
export async function boxNetworkBytes(boxes: BoxService, box: string): Promise<number | undefined> {
  const { bin, args } = boxes.exec(box, 'cat', ['/proc/net/dev']);
  try {
    const { stdout } = await run(bin, args, { timeout: 10_000 });
    return networkBytes(stdout);
  } catch {
    return undefined;
  }
}

// Received plus sent over every interface but loopback: the agent's own traffic to itself is not activity.
export function networkBytes(procNetDev: string): number | undefined {
  let total = 0;
  let seen = false;
  for (const line of procNetDev.split('\n').slice(2)) {
    const [name, rest] = line.split(':');
    if (rest === undefined || name?.trim() === 'lo') continue;
    const fields = rest.trim().split(/\s+/).map(Number);
    const received = fields[0];
    const sent = fields[8];
    if (received === undefined || sent === undefined || Number.isNaN(received) || Number.isNaN(sent))
      continue;
    total += received + sent;
    seen = true;
  }
  return seen ? total : undefined;
}
