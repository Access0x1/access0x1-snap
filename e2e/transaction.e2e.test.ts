import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { calldata, rawHandlers, MERCHANT_NAME, ORDER_LABEL, OTHER, PAYER, ROUTER, startSnap, textOf, WETH } from './harness';

type Started = Awaited<ReturnType<typeof startSnap>>;
let env: Started;

beforeAll(async () => {
  env = await startSnap(8453);
});
afterAll(async () => {
  await env.close();
});

const tx = (to: `0x${string}`, data: `0x${string}`, chainId = 'eip155:8453') =>
  env.snap.onTransaction({ chainId: chainId as `${string}:${string}`, from: PAYER, to, data });
/** Same request, for the cases where the Snap must answer with no screen at all. */
const txRaw = (to: `0x${string}`, data: `0x${string}`, chainId = 'eip155:8453') =>
  rawHandlers(env.snap).onTransaction({ chainId, from: PAYER, to, data });

describe('onTransaction', () => {
  it('shows the payment panel for a payToken call to the router on Base', async () => {
    const { response } = await tx(ROUTER, calldata.payToken());
    expect(response).toHaveProperty('result.content');
    const text = textOf(response);
    expect(text).toContain('$29.00');
    expect(text).toContain(ORDER_LABEL);
    expect(text).toContain('Base');
    expect(text).toContain(MERCHANT_NAME);
    expect(text).toContain('USDC');
  });

  it('asks the chain (mocked eth_call) for the merchant, and nothing else leaves the machine', async () => {
    await tx(ROUTER, calldata.payToken());
    expect(env.chain.calls.length).toBeGreaterThan(0);
    expect(env.chain.calls.some((call) => call.to.toLowerCase() === ROUTER.toLowerCase())).toBe(true);
  });

  it('shows nothing for the same call to another address', async () => {
    const { response } = await txRaw(OTHER, calldata.payToken());
    expect(response).toStrictEqual({ result: null });
  });

  it('shows nothing for a plain ERC-20 transfer', async () => {
    const { response } = await txRaw(ROUTER, calldata.erc20Transfer());
    expect(response).toStrictEqual({ result: null });
    const other = await txRaw(OTHER, calldata.erc20Transfer());
    expect(other.response).toStrictEqual({ result: null });
  });

  it('shows the "pay with" path for a swapAndPay call', async () => {
    const { response } = await tx(ROUTER, calldata.swapAndPay());
    const text = textOf(response);
    expect(text).toContain('You pay with');
    expect(text).toContain('WETH');
    expect(text).toContain('Uniswap');
    expect(text).toContain('$29.00');
    expect(text).toContain(WETH);
  });

  it('names the network from the chain id the wallet sends', async () => {
    const { response } = await tx(ROUTER, calldata.payToken(), 'eip155:130');
    expect(textOf(response)).toContain('Unichain');
  });
});
