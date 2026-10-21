import { encodeAbiParameters, encodeEventTopics, pad, stringToHex, toHex } from 'viem/utils';
import { describe, expect, it, vi } from 'vitest';

import { PAYMENT_RECEIVED_ABI } from '../src/router/abi';
import type { SnapConfigState, Watch } from '../src/types';
import {
  MAX_BLOCK_SPAN,
  MAX_NOTIFICATIONS,
  MAX_WATCHES,
  checkPayments,
  parseWatchParams,
  paymentMessage,
  withWatch,
  withoutWatch,
} from '../src/watch/watch';

const ROUTER = '0xe92244e3368561faf21648146511DeDE3a475EB5' as const;
const BUYER = '0x1234567890123456789012345678901234567890' as const;

const base: SnapConfigState = { routerAddress: ROUTER, chainIds: [8453] };
const watch = (over: Partial<Watch> = {}): Watch => ({ chainId: 8453, merchantId: '7', lastBlock: '100', ...over });

/** A PaymentReceived log for merchant 7: $29.00, order "booking-1". */
function log() {
  const topics = encodeEventTopics({ abi: PAYMENT_RECEIVED_ABI, eventName: 'PaymentReceived', args: { merchantId: 7n, buyer: BUYER, token: '0x0000000000000000000000000000000000000000' } });
  const data = encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bytes32' }, { type: 'uint64' }],
    [1n, 0n, 1n, 2_900_000_000n, pad(stringToHex('booking-1'), { size: 32, dir: 'right' }), 0n],
  );
  return { topics: topics as string[], data, blockNumber: '0x65' };
}

/** A snap whose state is kept in memory, and a wallet on `chain` at block `latest` returning `logs`. */
function world(state: SnapConfigState | null, opts: { chain?: string; latest?: bigint; logs?: unknown[]; getLogsFails?: boolean } = {}) {
  let current = state;
  const notes: string[] = [];
  const snap = {
    request: vi.fn(async ({ method, params }: { method: string; params?: unknown }) => {
      if (method === 'snap_manageState') {
        const p = params as { operation: string; newState?: SnapConfigState };
        if (p.operation === 'update') current = p.newState!;
        return p.operation === 'get' ? current : null;
      }
      if (method === 'snap_notify') notes.push((params as { message: string }).message);
      return null;
    }),
  };
  const provider = {
    request: vi.fn(async ({ method }: { method: string; params?: unknown[] }) => {
      if (method === 'eth_chainId') return opts.chain ?? '0x2105';
      if (method === 'eth_blockNumber') return toHex(opts.latest ?? 200n);
      if (opts.getLogsFails) throw new Error('rate limited');
      return opts.logs ?? [];
    }),
  };
  return { snap, provider, notes, state: () => current };
}

describe('parseWatchParams', () => {
  it('accepts a number or decimal-string id with a chain id', () => {
    expect(parseWatchParams({ merchantId: 7, chainId: 8453 })).toEqual({ merchantId: 7n, chainId: 8453 });
    expect(parseWatchParams({ merchantId: '12', chainId: 1 })).toEqual({ merchantId: 12n, chainId: 1 });
  });
  it('rejects anything else', () => {
    for (const bad of [null, {}, { merchantId: -1, chainId: 1 }, { merchantId: '0x7', chainId: 1 }, { merchantId: 7 }, { merchantId: 7, chainId: '1' }, { merchantId: 7, chainId: 0 }]) {
      expect(parseWatchParams(bad)).toBeNull();
    }
  });
});

describe('withWatch / withoutWatch', () => {
  it('adds once, removes, and caps the list', () => {
    const one = withWatch(base, watch())!;
    expect(withWatch(one, watch({ lastBlock: '300' }))!.watches).toEqual([watch({ lastBlock: '300' })]);
    expect(withoutWatch(one, 8453, '7').watches).toEqual([]);
    let full: SnapConfigState = base;
    for (let i = 0; i < MAX_WATCHES; i += 1) full = withWatch(full, watch({ merchantId: String(i) }))!;
    expect(withWatch(full, watch({ merchantId: '999' }))).toBeNull();
  });
});

describe('paymentMessage', () => {
  it('names merchant, chain, amount, payer and order', () => {
    expect(paymentMessage(log(), watch())).toBe('Merchant #7 on Base received $29.00 from 0x1234…7890, order booking-1.');
  });
  it('returns null for a log that does not decode', () => {
    expect(paymentMessage({ topics: ['0x00'], data: '0x', blockNumber: '0x1' }, watch())).toBeNull();
  });
});

describe('checkPayments', () => {
  it('does nothing without watches', async () => {
    const w = world(base);
    expect(await checkPayments(w.snap, w.provider)).toEqual({ notified: 0, waiting: 0, failed: 0 });
    expect(w.provider.request).not.toHaveBeenCalled();
  });

  it('notifies for each new payment and moves the position to the latest block', async () => {
    const w = world({ ...base, watches: [watch()] }, { logs: [log(), log()] });
    expect(await checkPayments(w.snap, w.provider)).toEqual({ notified: 2, waiting: 0, failed: 0 });
    expect(w.notes).toHaveLength(2);
    expect(w.state()!.watches![0]!.lastBlock).toBe('200');
    const call = w.provider.request.mock.calls.find((c) => c[0].method === 'eth_getLogs')![0];
    const query = (call.params as { fromBlock: string; address: string; topics: string[] }[])[0]!;
    expect(query.fromBlock).toBe('0x65');
    expect(query.address).toBe(ROUTER);
    expect(query.topics[1]).toBe(pad('0x7', { size: 32 }));
  });

  it('waits, without losing its place, when the wallet is on another network', async () => {
    const w = world({ ...base, watches: [watch()] }, { chain: '0x1', logs: [log()] });
    expect(await checkPayments(w.snap, w.provider)).toEqual({ notified: 0, waiting: 1, failed: 0 });
    expect(w.notes).toHaveLength(0);
    expect(w.state()!.watches![0]!.lastBlock).toBe('100');
  });

  it('keeps the position when the node fails, so the payment is notified next time', async () => {
    const w = world({ ...base, watches: [watch()] }, { getLogsFails: true });
    expect(await checkPayments(w.snap, w.provider)).toEqual({ notified: 0, waiting: 0, failed: 1 });
    expect(w.state()!.watches![0]!.lastBlock).toBe('100');
  });

  it('summarises beyond the notification cap and limits the block span', async () => {
    const logs = Array.from({ length: MAX_NOTIFICATIONS + 3 }, log);
    const w = world({ ...base, watches: [watch({ lastBlock: '0' })] }, { latest: 100_000n, logs });
    await checkPayments(w.snap, w.provider);
    expect(w.notes).toHaveLength(MAX_NOTIFICATIONS + 1);
    expect(w.notes.at(-1)).toContain('3 more payments');
    expect(w.state()!.watches![0]!.lastBlock).toBe(MAX_BLOCK_SPAN.toString());
  });

  it('does not query when there is no new block', async () => {
    const w = world({ ...base, watches: [watch({ lastBlock: '200' })] });
    await checkPayments(w.snap, w.provider);
    expect(w.provider.request.mock.calls.some((c) => c[0].method === 'eth_getLogs')).toBe(false);
  });
});
