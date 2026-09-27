import { describe, expect, it } from 'vitest';
import { networkBytes } from '../src/server/boxes/box-activity.js';

// DECISION 101: what keeps a Mini run alive is its box's traffic — received plus sent, loopback excluded.
const PROC = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo:  9999      10    0    0    0     0          0         0     9999      10    0    0    0     0       0          0
  eth0:  1200      12    0    0    0     0          0         0      800       8    0    0    0     0       0          0
  eth1:    50       1    0    0    0     0          0         0       25       1    0    0    0     0       0          0
`;

describe('a box’s network traffic', () => {
  it('sums every interface but loopback, both directions', () => {
    expect(networkBytes(PROC)).toBe(1200 + 800 + 50 + 25);
  });

  it('is unknown when there is nothing to read', () => {
    expect(networkBytes('')).toBeUndefined();
    expect(networkBytes('Inter-|\n face |\n    lo: 1 2 3 4 5 6 7 8 9\n')).toBeUndefined();
  });
});
