import { decodeFunctionData, encodeAbiParameters, encodeFunctionResult, keccak256, pad, parseAbi, stringToBytes } from 'viem/utils';
import { namehash } from 'viem/ens';
import { describe, expect, it, vi } from 'vitest';

import { ENS_REGISTRY, reverseEns } from '../src/names/ens';
import { lookupAddress, numericChain } from '../src/names/lookup';
import { REGISTERED_TOPIC } from '../src/names/merchants';
import { MERCHANTS_ABI } from '../src/router/abi';
import { MAINNET_ROUTER } from '../src/router/chains';
import type { EthProvider } from '../src/router/merchant';

const ALICE = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
const OTHER = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const;
const ZERO = '0x0000000000000000000000000000000000000000' as const;
const RESOLVER = '0xcccccccccccccccccccccccccccccccccccccccc' as const;
const ENS_ABI = parseAbi([
  'function resolver(bytes32 node) view returns (address)',
  'function name(bytes32 node) view returns (string)',
  'function addr(bytes32 node) view returns (address)',
]);

/** A node that answers the router's logs and merchants(id), and an ENS registry/resolver pair. */
function chain(opts: { chainId?: string; owner?: `0x${string}`; payout?: `0x${string}`; active?: boolean; nameHash?: `0x${string}`; ensName?: string; ensAddr?: `0x${string}` } = {}): EthProvider & { request: ReturnType<typeof vi.fn> } {
  const nameHash = opts.nameHash ?? ('0x' + '0'.repeat(64)) as `0x${string}`;
  const registered = {
    topics: [REGISTERED_TOPIC, pad('0x7', { size: 32 }), pad(opts.owner ?? ALICE, { size: 32 })],
    data: encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'uint16' }, { type: 'bytes32' }], [opts.payout ?? ALICE, ZERO, 0, nameHash]),
  };
  const request = vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
    if (method === 'eth_chainId') return opts.chainId ?? '0x1';
    if (method === 'eth_getLogs') {
      const topics = (params?.[0] as { topics: (string | null)[] }).topics;
      const ownerTopic = topics[2];
      return !ownerTopic || ownerTopic.toLowerCase() === registered.topics[2]!.toLowerCase() ? [registered] : [];
    }
    const { to, data } = params?.[0] as { to: string; data: `0x${string}` };
    if (to.toLowerCase() === MAINNET_ROUTER.toLowerCase()) {
      return encodeFunctionResult({
        abi: MERCHANTS_ABI,
        functionName: 'merchants',
        result: [opts.payout ?? ALICE, opts.owner ?? ALICE, ZERO, 0, opts.active ?? true, nameHash],
      });
    }
    const call = decodeFunctionData({ abi: ENS_ABI, data });
    const reverseNode = namehash(`${ALICE.slice(2)}.addr.reverse`);
    if (to.toLowerCase() === ENS_REGISTRY.toLowerCase()) {
      const known = [reverseNode, namehash(opts.ensName ?? 'alice.eth')];
      return encodeFunctionResult({ abi: ENS_ABI, functionName: 'resolver', result: known.includes(call.args![0] as `0x${string}`) && opts.ensName ? RESOLVER : ZERO });
    }
    if (call.functionName === 'name') return encodeFunctionResult({ abi: ENS_ABI, functionName: 'name', result: opts.ensName ?? '' });
    return encodeFunctionResult({ abi: ENS_ABI, functionName: 'addr', result: opts.ensAddr ?? ALICE });
  });
  return { request } as never;
}

const resolveDeps = (body: unknown = null) => ({
  snap: { request: vi.fn(async () => null) },
  apiBaseUrl: 'https://api.example',
  fetchImpl: vi.fn(async () => ({ ok: body !== null, json: async () => body })),
});
const deps = (provider: EthProvider, body: unknown = null) => ({ provider, state: null, resolve: resolveDeps(body) });

describe('numericChain', () => {
  it('reads eip155 ids only', () => {
    expect(numericChain('eip155:8453')).toBe(8453);
    expect(numericChain('solana:5eykt')).toBeNull();
    expect(numericChain('eip155:abc')).toBeNull();
  });
});

describe('reverseEns', () => {
  it('returns a name that resolves back to the address', async () => {
    expect(await reverseEns(ALICE, chain({ ensName: 'alice.eth' }))).toBe('alice.eth');
  });

  it('refuses a name that resolves to another address', async () => {
    expect(await reverseEns(ALICE, chain({ ensName: 'alice.eth', ensAddr: OTHER }))).toBeNull();
  });

  it('refuses a name with look-alike characters, and a miss', async () => {
    expect(await reverseEns(ALICE, chain({ ensName: 'аlice.eth' }))).toBeNull();
    expect(await reverseEns(ALICE, chain())).toBeNull();
  });
});

describe('lookupAddress', () => {
  it('names a merchant by its readable name only when it matches the on-chain nameHash', async () => {
    const nameHash = keccak256(stringToBytes('joe pizza'));
    const names = await lookupAddress('eip155:8453', ALICE, deps(chain({ chainId: '0x2105', nameHash }), { name: 'Joe Pizza' }));
    expect(names).toEqual([{ protocol: 'Access0x1 merchant', resolvedDomain: 'Joe Pizza' }]);
  });

  it('falls back to "Merchant #id" when the off-chain name does not match the nameHash', async () => {
    const nameHash = keccak256(stringToBytes('joe pizza'));
    const names = await lookupAddress('eip155:8453', ALICE, deps(chain({ chainId: '0x2105', nameHash }), { name: 'Apple Support' }));
    expect(names).toEqual([{ protocol: 'Access0x1 merchant', resolvedDomain: 'Merchant #7' }]);
  });

  it('adds the ENS name on Ethereum', async () => {
    const names = await lookupAddress('eip155:1', ALICE, deps(chain({ ensName: 'alice.eth' })));
    expect(names.map((n) => n.protocol)).toEqual(['Access0x1 merchant', 'ENS']);
  });

  it('finds a merchant by its payout address when the address is not the owner', async () => {
    const names = await lookupAddress('eip155:8453', OTHER, deps(chain({ chainId: '0x2105', owner: ALICE, payout: OTHER })));
    expect(names).toEqual([{ protocol: 'Access0x1 merchant', resolvedDomain: 'Merchant #7' }]);
  });

  it('ignores a merchant that is no longer active or whose owner changed', async () => {
    expect(await lookupAddress('eip155:8453', ALICE, deps(chain({ chainId: '0x2105', active: false })))).toEqual([]);
    expect(await lookupAddress('eip155:8453', ALICE, deps(chain({ chainId: '0x2105', owner: OTHER, payout: OTHER })))).toEqual([]);
  });

  it('answers nothing off the four mainnets, on a bad address, or when the wallet is on another chain', async () => {
    expect(await lookupAddress('eip155:84532', ALICE, deps(chain()))).toEqual([]);
    expect(await lookupAddress('eip155:1', 'not-an-address', deps(chain()))).toEqual([]);
    expect(await lookupAddress('eip155:8453', ALICE, deps(chain({ chainId: '0x1' })))).toEqual([]);
  });

  it('never throws on a failing node', async () => {
    const broken = { request: vi.fn().mockRejectedValue(new Error('down')) };
    expect(await lookupAddress('eip155:1', ALICE, deps(broken))).toEqual([]);
  });
});
