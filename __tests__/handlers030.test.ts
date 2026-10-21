import { readFileSync } from 'node:fs';

import { MethodNotFoundError } from '@metamask/snaps-sdk';
import { encodeFunctionResult } from 'viem/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { onCronjob, onHomePage, onNameLookup, onRpcRequest, onSignature } from '../src/index';
import { MERCHANTS_ABI } from '../src/router/abi';
import type { SnapConfigState } from '../src/types';

const g = globalThis as unknown as { snap?: unknown; ethereum?: unknown };
const saved = { snap: g.snap, ethereum: g.ethereum };
const ZERO = '0x0000000000000000000000000000000000000000' as const;
const OWNER = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const;

let state: SnapConfigState | null;
let dialogAnswer: unknown;
let owner: `0x${string}`;
const notified: string[] = [];

beforeEach(() => {
  state = null;
  dialogAnswer = true;
  owner = OWNER;
  notified.length = 0;
  g.snap = {
    request: vi.fn(async ({ method, params }: { method: string; params?: { operation?: string; newState?: SnapConfigState; message?: string } }) => {
      if (method === 'snap_manageState') {
        if (params?.operation === 'update') state = params.newState!;
        return params?.operation === 'get' ? state : null;
      }
      if (method === 'snap_dialog') return dialogAnswer;
      if (method === 'snap_notify') notified.push(params!.message!);
      return null;
    }),
  };
  g.ethereum = {
    request: vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_chainId') return '0x2105'; // Base
      if (method === 'eth_blockNumber') return '0x3e8';
      if (method === 'eth_getLogs') return [];
      return encodeFunctionResult({ abi: MERCHANTS_ABI, functionName: 'merchants', result: [OWNER, owner, ZERO, 0, true, ('0x' + '0'.repeat(64)) as `0x${string}`] });
    }),
  };
});

afterEach(() => {
  g.snap = saved.snap;
  g.ethereum = saved.ethereum;
});

const rpc = (method: string, params: unknown) =>
  onRpcRequest({ origin: 'https://dapp.example', request: { jsonrpc: '2.0', id: 1, method, params } } as Parameters<typeof onRpcRequest>[0]);

describe('onHomePage', () => {
  it('lists the four networks and how fees work, and names no internal product', async () => {
    const { content } = (await onHomePage()) as { content: unknown };
    const text = JSON.stringify(content);
    for (const name of ['Ethereum', 'Base', 'Unichain', 'Arc']) expect(text).toContain(name);
    expect(text).toContain('How fees work');
    expect(text).toContain("business's own fee rule");
    expect(text).toContain('rule for its app');
    expect(text).toContain('paid straight away, in the same transaction');
  });

  it('shows how many merchants are watched', async () => {
    state = { routerAddress: ZERO, chainIds: [], watches: [{ chainId: 8453, merchantId: '7', lastBlock: '1' }] };
    const { content } = (await onHomePage()) as { content: unknown };
    expect(JSON.stringify(content)).toContain('"children":"1"');
  });
});

describe('onSignature', () => {
  it('returns null for a signature that is not a Permit2 permit to the router', async () => {
    expect(await onSignature({ signature: { signatureMethod: 'personal_sign', from: '0x1', data: '0x' } } as Parameters<typeof onSignature>[0])).toBeNull();
  });
});

describe('onNameLookup', () => {
  it('returns null for a domain input (reverse lookup only)', async () => {
    expect(await onNameLookup({ chainId: 'eip155:1', domain: 'alice.eth' })).toBeNull();
  });
  it('returns null for an address that is no merchant', async () => {
    expect(await onNameLookup({ chainId: 'eip155:84532', address: OWNER })).toBeNull();
  });
});

describe('onCronjob', () => {
  it('runs the payment check and rejects an unknown job', async () => {
    expect(await onCronjob({ request: { jsonrpc: '2.0', id: 1, method: 'checkPayments' } })).toBeNull();
    await expect(onCronjob({ request: { jsonrpc: '2.0', id: 1, method: 'other' } })).rejects.toBeInstanceOf(MethodNotFoundError);
  });
});

describe('watchMerchant', () => {
  it('watches from the current block after the user confirms, and lists it', async () => {
    expect(await rpc('watchMerchant', { merchantId: 7, chainId: 8453 })).toEqual({ ok: true, watching: true });
    expect(state!.watches).toEqual([{ chainId: 8453, merchantId: '7', lastBlock: '1000' }]);
    expect(await rpc('getWatches', {})).toEqual(state!.watches);
  });

  it('records nothing when the user declines', async () => {
    dialogAnswer = false;
    expect(await rpc('watchMerchant', { merchantId: 7, chainId: 8453 })).toEqual({ ok: true, watching: false });
    expect(state).toBeNull();
  });

  it('refuses bad params, an unsupported chain, the wrong network and an unknown merchant', async () => {
    await expect(rpc('watchMerchant', { merchantId: 'x', chainId: 8453 })).rejects.toThrow('invalid_watch_params');
    await expect(rpc('watchMerchant', { merchantId: 7, chainId: 84532 })).rejects.toThrow('unsupported_chain');
    await expect(rpc('watchMerchant', { merchantId: 7, chainId: 1 })).rejects.toThrow('switch_to_that_network_first');
    owner = ZERO;
    await expect(rpc('watchMerchant', { merchantId: 7, chainId: 8453 })).rejects.toThrow();
  });

  it('unwatches, and keeps watches through configure', async () => {
    await rpc('watchMerchant', { merchantId: 7, chainId: 8453 });
    await rpc('configure', { routerAddress: OWNER, chainIds: [8453] });
    expect(state!.watches).toHaveLength(1);
    expect(await rpc('unwatchMerchant', { merchantId: 7, chainId: 8453 })).toEqual({ ok: true });
    expect(state!.watches).toEqual([]);
  });
});

describe('manifest', () => {
  const manifest = JSON.parse(readFileSync(new URL('../snap.manifest.json', import.meta.url), 'utf8'));
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

  it('has the same version as package.json and an allowlist-safe name', () => {
    expect(manifest.version).toBe('0.1.1');
    expect(pkg.version).toBe(manifest.version);
    expect(manifest.proposedName).not.toMatch(/metamask|snap|meta|mask/iu);
  });

  it('declares exactly the permissions the code uses', () => {
    expect(Object.keys(manifest.initialPermissions).sort()).toEqual(
      ['endowment:cronjob', 'endowment:ethereum-provider', 'endowment:name-lookup', 'endowment:network-access', 'endowment:page-home', 'endowment:rpc', 'endowment:signature-insight', 'endowment:transaction-insight', 'snap_dialog', 'snap_manageState', 'snap_notify'],
    );
    expect(manifest.initialPermissions['endowment:cronjob'].jobs[0].expression).toBe('*/10 * * * *');
    expect(manifest.initialPermissions['endowment:name-lookup'].chains).toEqual(['eip155:1', 'eip155:8453', 'eip155:130', 'eip155:5042']);
  });
});
