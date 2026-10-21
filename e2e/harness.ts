/**
 * End-to-end harness: loads the BUILT Snap (dist/bundle.js + snap.manifest.json) into the official MetaMask Snaps
 * simulation (@metamask/snaps-simulation) and talks to it the way the wallet does. Plain Node, no network.
 *
 * The simulation fetches the Snap from a `local:` URL, so a tiny static server hands out the package folder on the
 * loopback interface. The same server answers the white-label branding lookup, so no test leaves the machine.
 */

import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getOptions, handleRequest, installSnap } from '@metamask/snaps-simulation';
import { encodeFunctionData, encodeAbiParameters, stringToHex, pad, toFunctionSelector } from 'viem/utils';

import { ROUTER_ABI } from '../src/router/abi';

export const SNAP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ROUTER = '0xe92244e3368561faf21648146511DeDE3a475EB5' as const;
export const OTHER = '0x1111111111111111111111111111111111111111' as const;
export const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const;
export const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as const;
export const PAYER = '0x2222222222222222222222222222222222222222' as const;
export const PAYOUT = '0x3333333333333333333333333333333333333333' as const;
export const MERCHANT_NAME = 'Acme Coffee';
export const ORDER_LABEL = 'order-1';

export type Hex = `0x${string}`;
type Installed = Awaited<ReturnType<typeof installSnap>>;

/** Serve the built Snap files (and a branding endpoint) on 127.0.0.1; resolves with the server and its origin. */
export async function serveSnap(): Promise<{ server: Server; origin: string }> {
  const allowed = new Set(['snap.manifest.json', 'package.json', `dist${sep}bundle.js`, `images${sep}icon.svg`]);
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    res.setHeader('Access-Control-Allow-Origin', '*');
    const branding = /^\/api\/branding\/by-merchant\/(\d+)$/u.exec(path);
    if (branding) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ name: MERCHANT_NAME, description: 'Fresh beans' }));
      return;
    }
    const rel = normalize(path.replace(/^\/+/u, ''));
    if (!allowed.has(rel)) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.end(await readFile(join(SNAP_ROOT, rel)));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('server did not bind');
  }
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

/** What the mocked chain answers: one registered merchant, 1% platform fee, 5% merchant fee, USDC and WETH metadata. */
export type ChainOptions = { tokenSymbols?: Record<string, { symbol: string; decimals: number }> };

/** A JSON-RPC mock for `ethereum.request` inside the Snap: answers eth_chainId and the router and ERC-20 eth_calls. */
export function chainMock(chainId: number, options: ChainOptions = {}) {
  const tokens: Record<string, { symbol: string; decimals: number }> = {
    [USDC.toLowerCase()]: { symbol: 'USDC', decimals: 6 },
    [WETH.toLowerCase()]: { symbol: 'WETH', decimals: 18 },
    ...options.tokenSymbols,
  };
  const calls: { to: string; data: string }[] = [];
  const impl = (request: { method: string; params?: unknown }) => {
    if (request.method === 'eth_chainId') {
      return `0x${chainId.toString(16)}`;
    }
    if (request.method !== 'eth_call') {
      return undefined;
    }
    const [{ to, data }] = request.params as [{ to: string; data: Hex }];
    calls.push({ to, data });
    const selector = data.slice(0, 10);
    if (to.toLowerCase() === ROUTER.toLowerCase()) {
      if (selector === SELECTORS.platformFeeBps) {
        return encodeAbiParameters([{ type: 'uint16' }], [100]);
      }
      if (selector === SELECTORS.merchants) {
        return encodeAbiParameters(
          [{ type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'uint16' }, { type: 'bool' }, { type: 'bytes32' }],
          [PAYOUT, PAYER, PAYOUT, 500, true, pad('0x00', { size: 32 })],
        );
      }
      if (selector === SELECTORS.feeRuleOf) {
        return encodeAbiParameters([{ type: 'uint16' }, { type: 'uint64' }, { type: 'uint8' }], [100, 0n, 3]);
      }
    }
    const token = tokens[to.toLowerCase()];
    if (token && selector === SELECTORS.symbol) {
      return encodeAbiParameters([{ type: 'string' }], [token.symbol]);
    }
    if (token && selector === SELECTORS.decimals) {
      return encodeAbiParameters([{ type: 'uint8' }], [token.decimals]);
    }
    throw new Error(`unmocked eth_call ${to} ${selector}`);
  };
  return { impl, calls };
}

/** 4-byte selectors of the read calls the Snap makes (computed by viem, not typed from memory). */
export const SELECTORS = {
  merchants: toFunctionSelector('function merchants(uint256)'),
  platformFeeBps: toFunctionSelector('function platformFeeBps()'),
  feeRuleOf: toFunctionSelector('function feeRuleOf(uint256,address)'),
  symbol: toFunctionSelector('function symbol()'),
  decimals: toFunctionSelector('function decimals()'),
};

/** Calldata for the router calls and for an unrelated ERC-20 transfer. */
export const calldata = {
  payToken: (merchantId = 7n, usd8 = 2_900_000_000n, label = ORDER_LABEL, token: Hex = USDC): Hex =>
    encodeFunctionData({
      abi: ROUTER_ABI,
      functionName: 'payToken',
      args: [merchantId, token, usd8, pad(stringToHex(label), { size: 32, dir: 'right' })],
    }),
  swapAndPay: (): Hex =>
    encodeFunctionData({
      abi: ROUTER_ABI,
      functionName: 'swapAndPay',
      args: [7n, WETH, 10n ** 18n, USDC, 2_900_000_000n, pad(stringToHex(ORDER_LABEL), { size: 32, dir: 'right' }), '0x', 1_893_456_000n],
    }),
  erc20Transfer: (): Hex =>
    encodeFunctionData({
      abi: [{ type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] }],
      functionName: 'transfer',
      args: [OTHER, 25_000_000n],
    }),
};

/**
 * The simulation's own `onTransaction` / `onSignature` helpers assert that the Snap returned a screen, so they throw when
 * the Snap (correctly) returns nothing. These two send the same request the wallet does and hand back whatever the Snap
 * answered, including `{ result: null }`.
 */
export function rawHandlers(snap: Installed) {
  const { snapId, store, executionService, controllerMessenger, runSaga } = snap;
  const send = (handler: 'onTransaction' | 'onSignature', params: Record<string, unknown>) =>
    handleRequest({
      snapId,
      store,
      executionService,
      controllerMessenger,
      runSaga,
      simulationOptions: getOptions({}),
      handler: handler as never,
      request: { method: '', params: params as never },
    });
  return {
    onTransaction: (tx: { chainId: string; from: Hex; to: Hex; data: Hex }) =>
      send('onTransaction', {
        chainId: tx.chainId,
        transactionOrigin: 'metamask.io',
        transaction: { from: tx.from, to: tx.to, data: tx.data, value: '0x0', gasLimit: '0x5208', maxFeePerGas: '0x1', maxPriorityFeePerGas: '0x1', nonce: '0x0' },
      }),
    onSignature: (signature: { from: Hex; signatureMethod: string; data: unknown }) =>
      send('onSignature', { signatureOrigin: 'metamask.io', signature }),
  };
}

/** Install the built Snap, point its branding lookup at the local server, and mock the chain. */
export async function startSnap(chainId = 8453, configure = true): Promise<{ snap: Installed; close: () => Promise<void>; chain: ReturnType<typeof chainMock> }> {
  const { server, origin } = await serveSnap();
  const snap = await installSnap(`local:${origin}` as Parameters<typeof installSnap>[0]);
  const chain = chainMock(chainId);
  snap.mockJsonRpc(chain.impl);
  if (!configure) {
    return { snap, chain, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
  }
  const configured = await snap.request({
    method: 'configure',
    params: { routerAddress: ROUTER, chainIds: [1, 8453, 130, 5042], brandingApiBaseUrl: origin },
  });
  if ('error' in configured.response) {
    throw new Error(`configure failed: ${JSON.stringify(configured.response)}`);
  }
  return { snap, chain, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

/** Every string anywhere in a Snap UI tree (props and children), joined with newlines. */
export function textOf(node: unknown): string {
  const acc: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      acc.push(value);
    } else if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value && typeof value === 'object') {
      Object.values(value as object).forEach(walk);
    }
  };
  walk(node);
  return acc.join('\n');
}
