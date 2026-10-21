import { describe, expect, it, vi } from 'vitest';

import { MAINNET_ROUTER } from '../src/router/chains';
import { PERMIT2_ADDRESS, parsePermit2Signature } from '../src/signature/permit2';
import { fetchTokenMeta } from '../src/signature/tokenMeta';
import { formatDeadline, isUnlimited, renderPermit2Panel } from '../src/ui/permit2Panel';

const TOKEN = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

/** A well-formed Permit2 PermitTransferFrom request, with overrides for the parts a test changes. */
function permit(over: { spender?: string; verifyingContract?: string; chainId?: unknown; amount?: unknown; types?: unknown; primaryType?: string; deadline?: unknown } = {}) {
  return {
    signatureMethod: 'eth_signTypedData_v4',
    data: {
      domain: { name: 'Permit2', chainId: over.chainId ?? 8453, verifyingContract: over.verifyingContract ?? PERMIT2_ADDRESS },
      primaryType: over.primaryType ?? 'PermitTransferFrom',
      types: over.types ?? {
        PermitTransferFrom: [
          { name: 'permitted', type: 'TokenPermissions' },
          { name: 'spender', type: 'address' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
        TokenPermissions: [
          { name: 'token', type: 'address' },
          { name: 'amount', type: 'uint256' },
        ],
      },
      message: {
        permitted: { token: TOKEN, amount: over.amount ?? '25000000' },
        spender: over.spender ?? MAINNET_ROUTER,
        nonce: '7',
        deadline: over.deadline ?? '1893456000',
      },
    },
  };
}

const flat = (el: unknown): string => JSON.stringify(el);

describe('parsePermit2Signature', () => {
  it('reads a permit to the router on a mainnet', () => {
    const insight = parsePermit2Signature(permit(), null);
    expect(insight).toMatchObject({ chainId: 8453, token: TOKEN, amount: 25_000_000n, nonce: 7n, deadline: 1_893_456_000n });
  });

  it('accepts the router in any case', () => {
    expect(parsePermit2Signature(permit({ spender: MAINNET_ROUTER.toLowerCase() }), null)).not.toBeNull();
  });

  it('returns null when the spender is not the router', () => {
    expect(parsePermit2Signature(permit({ spender: '0x1111111111111111111111111111111111111111' }), null)).toBeNull();
  });

  it('returns null when the domain is not the canonical Permit2', () => {
    expect(parsePermit2Signature(permit({ verifyingContract: '0x1111111111111111111111111111111111111111' }), null)).toBeNull();
  });

  it('returns null when the struct layout differs from Permit2', () => {
    const types = { PermitTransferFrom: [{ name: 'permitted', type: 'TokenPermissions' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }], TokenPermissions: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }] };
    expect(parsePermit2Signature(permit({ types }), null)).toBeNull();
  });

  it('returns null for another primary type, another method, or non-typed data', () => {
    expect(parsePermit2Signature(permit({ primaryType: 'PermitBatchTransferFrom' }), null)).toBeNull();
    expect(parsePermit2Signature({ signatureMethod: 'personal_sign', data: '0x1234' }, null)).toBeNull();
    expect(parsePermit2Signature({ signatureMethod: 'eth_signTypedData_v4', data: {} }, null)).toBeNull();
  });

  it('returns null on a chain with no router, unless an app configured one for it', () => {
    expect(parsePermit2Signature(permit({ chainId: 84532 }), null)).toBeNull();
    const configured = { routerAddress: MAINNET_ROUTER, chainIds: [84532] };
    expect(parsePermit2Signature(permit({ chainId: 84532 }), configured)).not.toBeNull();
  });

  it('rejects a malformed amount', () => {
    expect(parsePermit2Signature(permit({ amount: '-5' }), null)).toBeNull();
    expect(parsePermit2Signature(permit({ amount: { evil: true } }), null)).toBeNull();
  });
});

describe('permit panel', () => {
  const insight = parsePermit2Signature(permit(), null)!;

  it('shows token, the most it can spend, expiry and that only the router uses it once', () => {
    const text = flat(renderPermit2Panel(insight, { symbol: 'USDC', decimals: 6 }, Date.UTC(2026, 0, 1)));
    expect(text).toContain('USDC');
    expect(text).toContain('25 USDC');
    expect(text).toContain('2030-01-01 00:00 UTC');
    expect(text).toContain('Only the Access0x1 payment contract can use this, once');
  });

  it('shows raw units when the token cannot be read, and flags an unlimited permit', () => {
    expect(flat(renderPermit2Panel(insight, null, 0))).toContain('25000000 (smallest units)');
    const huge = parsePermit2Signature(permit({ amount: (2n ** 256n - 1n).toString() }), null)!;
    expect(isUnlimited(huge.amount)).toBe(true);
    expect(flat(renderPermit2Panel(huge, null, 0))).toContain('No limit');
    expect(isUnlimited(insight.amount)).toBe(false);
  });

  it('marks a passed deadline and an absent one', () => {
    expect(formatDeadline(1_000n, Date.now())).toContain('(already passed)');
    expect(formatDeadline(2n ** 255n, 0)).toBe('No expiry set');
  });
});

describe('fetchTokenMeta', () => {
  const answer = (chain: string) =>
    vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
      if (method === 'eth_chainId') return chain;
      const data = (params?.[0] as { data: string }).data;
      // symbol() then decimals(): the two selectors.
      return data.startsWith('0x95d89b41')
        ? '0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000455534443000000000000000000000000000000000000000000000000000000'.slice(0, 2 + 64 * 3)
        : '0x0000000000000000000000000000000000000000000000000000000000000006';
    });

  it('reads symbol and decimals on the permit chain', async () => {
    const meta = await fetchTokenMeta(TOKEN, 8453, { request: answer('0x2105') });
    expect(meta).toEqual({ symbol: 'USDC', decimals: 6 });
  });

  it('returns null when the wallet is on another chain, and on a failing node', async () => {
    expect(await fetchTokenMeta(TOKEN, 8453, { request: answer('0x1') })).toBeNull();
    expect(await fetchTokenMeta(TOKEN, 8453, { request: vi.fn().mockRejectedValue(new Error('x')) })).toBeNull();
  });
});
