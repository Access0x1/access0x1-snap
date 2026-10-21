import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ROUTER, startSnap } from './harness';

type Started = Awaited<ReturnType<typeof startSnap>>;
let env: Started;

beforeAll(async () => {
  env = await startSnap(8453, false);
});
afterAll(async () => {
  await env.close();
});

describe('onRpcRequest', () => {
  it('getRouterConfig is empty before anything is configured', async () => {
    const { response } = await env.snap.request({ method: 'getRouterConfig' });
    expect(response).toStrictEqual({ result: { routerAddress: null, chainIds: [] } });
  });

  it('configure stores the router and chains, and getRouterConfig reads them back', async () => {
    const configured = await env.snap.request({
      method: 'configure',
      params: { routerAddress: ROUTER, chainIds: [8453, 1] },
    });
    expect(configured.response).toStrictEqual({ result: { ok: true } });

    const { response } = await env.snap.request({ method: 'getRouterConfig' });
    expect(response).toStrictEqual({ result: { routerAddress: ROUTER, chainIds: [8453, 1] } });
  });

  it('answers an unknown method with a method-not-found error', async () => {
    const { response } = await env.snap.request({ method: 'doesNotExist' });
    expect(response).toHaveProperty('error');
  });
});
