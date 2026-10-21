import { encodeFunctionData } from 'viem/utils';
import { describe, expect, it } from 'vitest';

import { ROUTER_ABI } from '../src/router/abi';
import { chainLabel, defaultRouterFor, MAINNET_ROUTER } from '../src/router/chains';
import { parseRouterCall } from '../src/router/decode';
import { computeRuleFeeSplit } from '../src/ui/insightPanel';

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const WETH = '0x4200000000000000000000000000000000000006';
const ORDER = '0x6f726465722d3100000000000000000000000000000000000000000000000000';

describe('pay with any token', () => {
  it('decodes swapAndPay: the customer pays WETH, the merchant is paid in USDC', () => {
    const data = encodeFunctionData({ abi: ROUTER_ABI, functionName: 'swapAndPay', args: [7n, WETH, 10n ** 16n, USDC, 2_500_000_000n, ORDER, '0x', 1n] });
    const s = parseRouterCall({ data }, 8453);
    expect(s).toMatchObject({ merchantId: 7n, token: USDC, usdAmount8: 2_500_000_000n, orderIdLabel: 'order-1', chainLabel: 'Base', swap: { payWith: WETH, maxIn: 10n ** 16n, permit2: false } });
  });

  it('decodes swapAndPayWithPermit2 and marks it as a Permit2 payment', () => {
    const data = encodeFunctionData({ abi: ROUTER_ABI, functionName: 'swapAndPayWithPermit2', args: [7n, WETH, 1n, USDC, 1n, ORDER, '0x', 1n, '0x'] });
    expect(parseRouterCall({ data }, 1)?.swap?.permit2).toBe(true);
  });

  it('decodes swapAndPayNative: pays with the native coin, the cap is the value sent', () => {
    const data = encodeFunctionData({ abi: ROUTER_ABI, functionName: 'swapAndPayNative', args: [7n, USDC, 1n, ORDER, '0x', 1n] });
    expect(parseRouterCall({ data, value: '0x2386f26fc10000' }, 130)?.swap).toEqual({ payWith: null, maxIn: 10n ** 16n, permit2: false });
  });

  it('still refuses calldata that is not a router payment (control)', () => {
    expect(parseRouterCall({ data: '0xa9059cbb' + '00'.repeat(64) }, 8453)).toBeNull();
  });
});

describe('mainnets', () => {
  it('knows the four mainnets and the one router address', () => {
    expect([1, 8453, 130, 5042].map(chainLabel)).toEqual(['Ethereum', 'Base', 'Unichain', 'Arc']);
    for (const id of [1, 8453, 130, 5042]) expect(defaultRouterFor(id)).toBe(MAINNET_ROUTER);
    expect(defaultRouterFor(84532)).toBeNull();
  });
});

describe('fee under the router rule', () => {
  it('applies the rule, its minimum, and the merchant surcharge', () => {
    // $10 at 1% with a $0.30 minimum: the minimum wins; plus a 4% surcharge.
    expect(computeRuleFeeSplit(1_000_000_000n, 100, 30_000_000n, 400)).toEqual({ fee: 70_000_000n, net: 930_000_000n });
    // App group: 1% with no minimum.
    expect(computeRuleFeeSplit(1_000_000_000n, 100, 0n, 400)).toEqual({ fee: 50_000_000n, net: 950_000_000n });
    // Never more than the gross.
    expect(computeRuleFeeSplit(10_000_000n, 100, 30_000_000n, 0).net).toBe(0n);
  });
});
