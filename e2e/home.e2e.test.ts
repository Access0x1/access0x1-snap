import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSnap, textOf } from './harness';

type Started = Awaited<ReturnType<typeof startSnap>>;
let env: Started;

beforeAll(async () => {
  env = await startSnap(8453, false);
});
afterAll(async () => {
  await env.close();
});

describe('onHomePage', () => {
  it('renders the title, the intro and the four networks', async () => {
    const { response } = await env.snap.onHomePage();
    const text = textOf(response);
    expect(text).toContain('Access0x1 Payments');
    for (const network of ['Ethereum', 'Base', 'Unichain', 'Arc']) {
      expect(text).toContain(`•  ${network}`);
    }
    expect(text).toContain('Businesses you follow');
  });
});
