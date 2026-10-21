import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { rawHandlers, OTHER, PAYER, ROUTER, startSnap, textOf, USDC } from './harness';

type Started = Awaited<ReturnType<typeof startSnap>>;
let env: Started;

beforeAll(async () => {
  env = await startSnap(8453);
});
afterAll(async () => {
  await env.close();
});

const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const MAX_UINT256 = (2n ** 256n - 1n).toString();

/** A Permit2 PermitTransferFrom typed-data request, the way a dapp sends it through the wallet. */
function permit(over: { spender?: string; amount?: string } = {}) {
  return {
    domain: { name: 'Permit2', chainId: 8453, verifyingContract: PERMIT2 },
    primaryType: 'PermitTransferFrom',
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
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
      permitted: { token: USDC, amount: over.amount ?? '25000000' },
      spender: over.spender ?? ROUTER,
      nonce: '7',
      deadline: '4102444800',
    },
  };
}

const sign = (data: Record<string, unknown>) =>
  env.snap.onSignature({ from: PAYER, signatureMethod: 'eth_signTypedData_v4', data });

describe('onSignature', () => {
  it('shows the permit screen for a Permit2 PermitTransferFrom to the router', async () => {
    const { response } = await sign(permit());
    const text = textOf(response);
    expect(text).toContain('Access0x1 payment permit');
    expect(text).toContain('USDC');
    expect(text).not.toContain('No limit on this permit');
    expect(response).not.toHaveProperty('result.severity');
  });

  it('shows the danger banner and a critical severity for an unlimited amount', async () => {
    const { response } = await sign(permit({ amount: MAX_UINT256 }));
    const text = textOf(response);
    expect(text).toContain('No limit on this permit');
    expect(text).toContain('danger');
    expect(response).toHaveProperty('result.severity', 'critical');
  });

  it('shows nothing when the spender is not the router', async () => {
    const { response } = await rawHandlers(env.snap).onSignature({
      from: PAYER,
      signatureMethod: 'eth_signTypedData_v4',
      data: permit({ spender: OTHER }),
    });
    expect(response).toStrictEqual({ result: null });
  });

  it('shows nothing for personal_sign', async () => {
    const { response } = await rawHandlers(env.snap).onSignature({
      from: PAYER,
      signatureMethod: 'personal_sign',
      data: '0x48656c6c6f',
    });
    expect(response).toStrictEqual({ result: null });
  });
});
